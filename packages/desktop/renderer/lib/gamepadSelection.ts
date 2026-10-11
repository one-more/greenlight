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
let latchedButtons: number[] | null = null
let buttonSampler: ReturnType<typeof setInterval> | null = null
let sampledPadId = ''

// The player only reads the pad every 16ms. Chromium's snapshot can show a
// tap on a frame the player does not sample, so the press never leaves the Mac.
const BUTTON_SAMPLE_MS = 4

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
    const nav = navigator as unknown as { getGamepads: GetGamepads }
    if (!originalGetGamepads) {
        originalGetGamepads = nav.getGamepads.bind(nav)
    }

    const read = originalGetGamepads
    sampledPadId = preferredId
    startButtonLatch()
    nav.getGamepads = () => remapToPrimarySlot(read(), preferredId)

    return () => {
        stopButtonLatch()
        if (!originalGetGamepads) {
            return
        }
        nav.getGamepads = originalGetGamepads
        originalGetGamepads = null
    }
}

function startButtonLatch() {
    stopButtonLatch()
    sampleHeldButtons()
    buttonSampler = setInterval(sampleHeldButtons, BUTTON_SAMPLE_MS)
}

function stopButtonLatch() {
    if (buttonSampler !== null) {
        clearInterval(buttonSampler)
        buttonSampler = null
    }
    latchedButtons = null
}

function sampleHeldButtons() {
    if (!originalGetGamepads) {
        return
    }
    const pad = choosePad(originalGetGamepads(), sampledPadId)
    if (!pad) {
        return
    }
    const live = Array.from(pad.buttons, (button) => button.value || 0)
    if (!latchedButtons || latchedButtons.length !== live.length) {
        latchedButtons = live
        return
    }
    for (let index = 0; index < live.length; index++) {
        latchedButtons[index] = Math.max(latchedButtons[index], live[index])
    }
}

function consumeLatchedButtons(liveButtons: readonly GamepadButton[]) {
    const live = Array.from(liveButtons, (button) => button.value || 0)
    const held = latchedButtons
    const reported = live.map((value, index) => Math.max(value, held && index < held.length ? held[index] : 0))
    latchedButtons = live
    return reported.map((value) => ({
        pressed: value > 0.1,
        touched: value > 0,
        value,
    }))
}

function readGamepads(): ReadonlyArray<Gamepad | null> {
    const nav = navigator as unknown as { getGamepads: GetGamepads }
    const read = originalGetGamepads || nav.getGamepads.bind(nav)
    return Array.from(read())
}

function choosePad(pads: ReadonlyArray<Gamepad | null>, preferredId: string): Gamepad | null {
    if (preferredId) {
        const preferred = pads.find((pad) => pad && pad.id === preferredId)
        if (preferred) {
            return preferred
        }
    }
    return pads.find((pad) => pad && pad.connected) || null
}

function remapToPrimarySlot(pads: ReadonlyArray<Gamepad | null>, preferredId: string): (Gamepad | null)[] {
    const selected = choosePad(pads, preferredId)
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
            if (prop === 'buttons') {
                const buttons = Reflect.get(target, 'buttons', target) as readonly GamepadButton[]
                return consumeLatchedButtons(buttons)
            }
            // Native Gamepad getters throw Illegal invocation if `this` is the proxy.
            const value = Reflect.get(target, prop, target)
            return typeof value === 'function' ? value.bind(target) : value
        },
    }) as Gamepad
}
