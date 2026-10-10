const BUTTON_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', 'Up', 'Down', 'Left', 'Right', 'Xbox']

export type ListedGamepad = {
    index: number
    id: string
    label: string
    rumble: boolean
    activity: string
}

type GetGamepads = () => ReadonlyArray<Gamepad | null>

let originalGetGamepads: GetGamepads | null = null

export function gamepadLabel(id: string): string {
    return id
        .replace(/\s*\((?:standard gamepad|xinput standard gamepad)\)\s*/ig, ' ')
        .replace(/\s*\(vendor:.*?\)\s*/ig, ' ')
        .replace(/\s+/g, ' ')
        .trim() || id
}

export function gamepadActivity(pad: Gamepad): string {
    const pressed: string[] = []

    pad.buttons.forEach((button, index) => {
        if (button.value > 0.4) {
            pressed.push(BUTTON_NAMES[index] || `Button ${index + 1}`)
        }
    })

    if (Math.abs(pad.axes[0] || 0) > 0.2 || Math.abs(pad.axes[1] || 0) > 0.2) {
        pressed.push('Left stick')
    }
    if (Math.abs(pad.axes[2] || 0) > 0.2 || Math.abs(pad.axes[3] || 0) > 0.2) {
        pressed.push('Right stick')
    }

    return pressed.join(', ')
}

export function listConnectedGamepads(): ListedGamepad[] {
    const pads = readGamepads()
    const connected: ListedGamepad[] = []

    for (let index = 0; index < pads.length; index++) {
        const pad = pads[index]
        if (!pad || !pad.connected) {
            continue
        }

        const actuator = (pad as Gamepad & { vibrationActuator?: { type?: string } | null }).vibrationActuator
        connected.push({
            index,
            id: pad.id,
            label: gamepadLabel(pad.id),
            rumble: actuator?.type === 'dual-rumble',
            activity: gamepadActivity(pad),
        })
    }

    return connected
}

// The console session only accepts controller slot 0. Chromium often leaves
// slot 0 empty and reports a Bluetooth Xbox pad later in the list, so the
// stream never sees it. Present the chosen pad as slot 0 for the player.
export function installSelectedGamepad(preferredId: string): () => void {
    const nav = navigator as Navigator & { getGamepads: GetGamepads }
    if (!originalGetGamepads) {
        originalGetGamepads = nav.getGamepads.bind(nav)
    }

    const read = originalGetGamepads
    nav.getGamepads = () => remapToPrimarySlot(read(), preferredId)

    return () => {
        if (!originalGetGamepads) {
            return
        }
        nav.getGamepads = originalGetGamepads
        originalGetGamepads = null
    }
}

function readGamepads(): ReadonlyArray<Gamepad | null> {
    const nav = navigator as Navigator & { getGamepads: GetGamepads }
    const read = originalGetGamepads || nav.getGamepads.bind(nav)
    return Array.from(read())
}

function remapToPrimarySlot(pads: ReadonlyArray<Gamepad | null>, preferredId: string): (Gamepad | null)[] {
    let selected: Gamepad | null = null

    if (preferredId) {
        selected = pads.find((pad) => pad && pad.id === preferredId) || null
    }
    if (!selected) {
        selected = pads.find((pad) => pad && pad.connected) || null
    }

    const mapped: (Gamepad | null)[] = [null, null, null, null]
    if (selected) {
        mapped[0] = proxyAsIndex(selected, 0)
    }
    return mapped
}

function proxyAsIndex(pad: Gamepad, index: number): Gamepad {
    return new Proxy(pad, {
        get(target, prop) {
            if (prop === 'index') {
                return index
            }
            // Native Gamepad getters throw Illegal invocation if `this` is the proxy.
            const value = Reflect.get(target, prop, target)
            return typeof value === 'function' ? value.bind(target) : value
        },
    }) as Gamepad
}
