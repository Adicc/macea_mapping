// Name: Reloop Mixage
// Author: HorstBaerbel / gqzomer
// Version: 1.1.2 requires Mixxx 2.4 or higher

var MACEA = {};

// ----- User-configurable settings -----
MACEA.scratchByWheelTouch = false; // Set to true to scratch by touching the jog wheel instead of having to toggle the disc button. Default is false
MACEA.scratchTicksPerRevolution = 620; // Number of jog wheel ticks that make a full revolution when scratching. Reduce to "scratch more" of the track, increase to "scratch less". Default is 620 (measured)
MACEA.jogWheelScrollSpeed = 1.0; // Scroll speed when the jog wheel is used to scroll through the track. The higher, the faster. Default is 1.0

// ----- Internal variables (don't touch) -----

// engine connections
MACEA.vuMeterConnection = [];
MACEA.loopConnection = [];
MACEA.fxOnConnection = [];
MACEA.fxSelectConnection = [];

// timers
MACEA.traxxPressTimer = 0;
MACEA.loopLengthPressTimer = 0;
MACEA.dryWetPressTimer = 0;
MACEA.scratchTogglePressTimer = 0;

// constants
MACEA.numEffectUnits = 4;
MACEA.numEffectSlots = 3;
var ON = 0x7F, OFF = 0x00, DOWN = 0x7F;
var QUICK_PRESS = 1, DOUBLE_PRESS = 2;

// these objects store the state of different buttons and modes
MACEA.channels = [
    "[Channel1]",
    "[Channel2]",
];

MACEA.scratchToggleState = {
    "[Channel1]": false,
    "[Channel2]": false,
};

MACEA.scrollToggleState = {
    "[Channel1]": false,
    "[Channel2]": false,
};

MACEA.wheelTouched = {
    "[Channel1]": false,
    "[Channel2]": false,
};

MACEA.loopLengthPressed = {
    "[Channel1]": false,
    "[Channel2]": false,
};

MACEA.dryWetPressed = {
    "[Channel1]": false,
    "[Channel2]": false,
};

MACEA.scratchPressed = {
    "[Channel1]": false,
    "[Channel2]": false,
};

MACEA.adjustLoop = {
    "[Channel1]": false,
    "[Channel2]": false,
};

MACEA.adjustLoopIn = {
    "[Channel1]": false,
    "[Channel2]": false,
};

MACEA.adjustLoopOut = {
    "[Channel1]": false,
    "[Channel2]": false,
};

MACEA.effectSlotState = {
    "[EffectRack1_EffectUnit1]": new Array(MACEA.numEffectSlots).fill(1),
    "[EffectRack1_EffectUnit2]": new Array(MACEA.numEffectSlots).fill(1),
};

MACEA.blinkTimer = {
    "[Channel1]": {},
    "[Channel2]": {},
};

// Maps channels and their controls to a MIDI control number to toggle their LEDs
MACEA.ledMap = {
    "[Channel1]": {
        "cue_indicator": 0x0A,
        "cue_default": 0x0B,
        "play_indicator": 0x0C,
        "load_indicator": 0x0D,
        "pfl": 0x0E,
        "loop": 0x05,
        "reloop": 0x06,
        "sync_enabled": 0x09,
        "fx_on": 0x08,
        "fx_sel": 0x07,
        "scratch_active": 0x04,
        "scroll_active": 0x03,
        "vu_meter": 0x1D,
    },
    "[Channel2]": {
        "cue_indicator": 0x18,
        "cue_default": 0x19,
        "play_indicator": 0x1A,
        "load_indicator": 0x1B,
        "pfl": 0x1C,
        "loop": 0x13,
        "reloop": 0x14,
        "sync_enabled": 0x17,
        "fx_on": 0x16,
        "fx_sel": 0x15,
        "scratch_active": 0x12,
        "scroll_active": 0x11,
        "vu_meter": 0x1E,
    }
};

// Maps mixxx controls to a function that toggles their LEDs
MACEA.connectionMap = {
    "cue_indicator": {"function": function(v, g, c) { MACEA.toggleLED(v, g, c); }},
    "cue_default": {"function": function(v, g, c) { MACEA.toggleLED(v, g, c); }},
    "play_indicator": {"function": function(v, g, c) { MACEA.toggleLED(v, g, c); MACEA.toggleLED(v, g, "load_indicator"); }},
    "pfl": {"function": function(v, g, c) { MACEA.toggleLED(v, g, c); }},
    "loop_enabled": {"function": function(_v, g) { MACEA.toggleReloopLED(g); }},
    "loop_in": {"function": function(v, g) { if (v === 1) { MACEA.toggleLoopLED(g); } }},
    "loop_out": {"function": function(v, g) { if (v === 1) { MACEA.toggleLoopLED(g); } }},
    "sync_enabled": {"function": function(v, g, c) { MACEA.toggleLED(v, g, c); }},
    "eject": {"function": function(_v, g) { MACEA.eject(g); }},
};

// ----- Internal variables functions -----

// Set or remove functions to call when the state of a mixxx control changes
MACEA.connectControlsToFunctions = function(group, remove) {
    for (var control in MACEA.connectionMap) {
        if (remove !== undefined) {
            MACEA.connectionMap[control][group].disconnect();
        } else {
            MACEA.connectionMap[control][group] = engine.makeConnection(group, control, MACEA.connectionMap[control].function);
        }
    }
};

MACEA.init = function(_id, _debugging) {

    // all button LEDs off
    for (var i = 0; i < 255; i++) {
        midi.sendShortMsg(0x90, i, 0);
    }

    // find controls and make engine connections for each channel in Mixage.channels
    // A predefined list with channels is used instead of a for loop to prevent engine connections to be overwritten
    MACEA.channels.forEach(function(channel) {
        var deck = script.deckFromGroup(channel);
        MACEA.connectControlsToFunctions(channel);

        // set soft takeovers for effectslot amount
        for (var effectSlot = 1; effectSlot <= MACEA.numEffectSlots; effectSlot++) {
            var groupString = "[EffectRack1_EffectUnit"+ deck +"_Effect" + effectSlot + "]";
            engine.softTakeover(groupString, "meta", true);
        }

        for (var effectUnit = 1; effectUnit <= MACEA.numEffectUnits; effectUnit++) {
            // make connections for the fx on LEDs
            var fxGroup = "group_"+channel+"_enable";
            MACEA.fxOnConnection.push(engine.makeConnection("[EffectRack1_EffectUnit"+effectUnit+"]", fxGroup, function() { MACEA.toggleFxLED(channel); }));

            // set soft takeovers for effectunit meta
            engine.softTakeover("[EffectRack1_EffectUnit"+effectUnit+"]", "super1", true);
            engine.setValue("[EffectRack1_EffectUnit"+effectUnit+"]", "show_focus", 1);
        }

        // set soft takeover for filter effect
        engine.softTakeover("[QuickEffectRack1_"+channel+"]", "super1", true);

        // make connections for status LEDs
        MACEA.vuMeterConnection.push(engine.makeConnection(channel, "vu_meter", function(val) { midi.sendShortMsg(0x90, MACEA.ledMap[channel].vu_meter, val * 7); }));
        MACEA.loopConnection.push(engine.makeConnection(channel, "track_loaded", function() { MACEA.toggleReloopLED(channel); }));
        MACEA.fxSelectConnection.push(engine.makeConnection("[EffectRack1_EffectUnit"+deck+"]", "focused_effect", function(value) { MACEA.handleFxSelect(value, channel); }));

        // get current status and set LEDs accordingly
        MACEA.toggleFxLED(channel);
        MACEA.handleFxSelect(engine.getValue("[EffectRack1_EffectUnit"+deck+"]", "focused_effect"), channel);
    });
};

MACEA.shutdown = function() {

    // Disconnect all engine connections that are present
    MACEA.vuMeterConnection.forEach(function(connection) { connection.disconnect(); });
    MACEA.loopConnection.forEach(function(connection) { connection.disconnect(); });
    MACEA.fxSelectConnection.forEach(function(connection) { connection.disconnect(); });
    MACEA.fxOnConnection.forEach(function(connection) { connection.disconnect(); });

    // Disconnect all controls from functions
    MACEA.channels.forEach(function(channel) { MACEA.connectControlsToFunctions(channel, true); });

    // all button LEDs off
    for (var i = 0; i < 255; i++) {
        midi.sendShortMsg(0x90, i, 0);
    }
};

// Toggle the LED on the MIDI controller by sending a MIDI message
MACEA.toggleLED = function(value, group, control) {
    midi.sendShortMsg(0x90, MACEA.ledMap[group][control], value ? 0x7F : 0);
};

// Toggles the FX On LED / Off when no effect unit is activated for a channel / On when any effect unit is active for a channel
MACEA.toggleFxLED = function(group) {
    var fxChannel = "group_" + group + "_enable";
    var enabledFxGroups = [];

    for (var i = 1; i <= MACEA.numEffectUnits; i++) {
        enabledFxGroups.push(engine.getValue("[EffectRack1_EffectUnit" + i + "]", fxChannel));
    }

    if (enabledFxGroups.indexOf(1) !== -1) {
        MACEA.toggleLED(ON, group, "fx_on");
    } else {
        MACEA.toggleLED(OFF, group, "fx_on");
    }
};

// Flash the Reloop LED if a loop is set but currently not active
MACEA.toggleReloopLED = function(group) {
    if (engine.getValue(group, "loop_enabled") === 0) {
        MACEA.toggleLED(OFF, group, "loop");
        MACEA.toggleLED(OFF, group, "reloop");

        if (engine.getValue(group, "loop_start_position") !== -1 && engine.getValue(group, "loop_end_position") !== -1) {
            MACEA.blinkLED(MACEA.ledMap[group].reloop, group, 1000);
        } else {
            MACEA.blinkLED(MACEA.ledMap[group].reloop, group, 0);
        }
    } else {
        MACEA.blinkLED(MACEA.ledMap[group].reloop, group, 0);
        MACEA.toggleLoopLED(group);
    }
};

// Turns the loop in and loop LEDs on if a loop end or start position is found, otherwise turn them off
MACEA.toggleLoopLED = function(group) {
    if (engine.getValue(group, "loop_start_position") !== -1) {
        MACEA.toggleLED(ON, group, "loop");
    } else {
        MACEA.toggleLED(OFF, group, "loop");
    }

    if (engine.getValue(group, "loop_end_position") !== -1) {
        MACEA.toggleLED(ON, group, "reloop");
    } else {
        MACEA.toggleLED(OFF, group, "reloop");
    }
};

// resets the loop LEDs when a track is ejected
MACEA.eject = function(group) {
    if (engine.getValue(group, "play") === 0) {
        if (MACEA.adjustLoop[group]) {
            MACEA.stopLoopAdjust();
        } else {
            MACEA.blinkLED(MACEA.ledMap[group].reloop, group, 0);
            MACEA.toggleLED(OFF, group, "loop");
        }
    }
};

// Removes any loop that is currently set on a track
MACEA.clearLoop = function(_channel, _control, _value, _status, group) {
    engine.setValue(group, "loop_end_position", -1);
    engine.setValue(group, "loop_start_position", -1);
};

// Enable the adjustment of the loop end or start position with the jogwheel
MACEA.startLoopAdjust = function(group, adjustpoint) {

    // enable adjustment of the loop in point
    if (adjustpoint === "start" || adjustpoint === undefined) {
        MACEA.adjustLoopIn[group] = true;
        MACEA.blinkLED(MACEA.ledMap[group].loop, group, 250);

        if (MACEA.adjustLoopOut[group] && adjustpoint === "start") {
            MACEA.adjustLoopOut[group] = false;
            MACEA.blinkLED(MACEA.ledMap[group].reloop, group, 0);
            MACEA.toggleLED(ON, group, "reloop");
        }
    }

    // enable adjustment of the loop out point
    if (adjustpoint === "end" || adjustpoint === undefined) {
        MACEA.adjustLoopOut[group] = true;
        MACEA.blinkLED(MACEA.ledMap[group].reloop, group, 250);

        if (MACEA.adjustLoopIn[group] && adjustpoint === "end") {
            MACEA.adjustLoopIn[group] = false;
            MACEA.blinkLED(MACEA.ledMap[group].loop, group, 0);
            MACEA.toggleLED(ON, group, "loop");
        }
    }

    // disable scratch mode if active
    if (MACEA.scratchToggleState[group]) {
        MACEA.toggleLED(OFF, group, "scratch_active");
        MACEA.scratchToggleState[group] = false;
    }

    // disable scroll mode if active
    if (MACEA.scrollToggleState[group]) {
        MACEA.toggleLED(OFF, group, "scroll_active");
        MACEA.scrollToggleState[group] = false;
    }
};

// Disable the adjustment of the loop end or start position with the jogwheel
MACEA.stopLoopAdjust = function(group, adjustpoint) {
    if (adjustpoint === "start" | adjustpoint === undefined) {
        MACEA.adjustLoopIn[group] = false;
        MACEA.blinkLED(MACEA.ledMap[group].loop, group, 0);
    }

    if (adjustpoint === "end" | adjustpoint === undefined) {
        MACEA.adjustLoopOut[group] = false;
        MACEA.blinkLED(MACEA.ledMap[group].reloop, group, 0);
    }

    if (adjustpoint === undefined) {
        MACEA.adjustLoop[group] = false;
    }

    MACEA.toggleReloopLED(group);
};

// Start blinking the LED for a given control based on the time parameter, stops blinking a control light if time is set to zero
// blinking is syncronized with the "indicator_250millis" control and the time parameter is rounded to the closest
MACEA.blinkLED = function(control, group, time) {

    // remove any connection that might be present
    if (Object.prototype.hasOwnProperty.call(MACEA.blinkTimer[group], control)) {
        MACEA.blinkTimer[group][control].timer.disconnect();
        delete MACEA.blinkTimer[group][control];
        midi.sendShortMsg(0x90, control, OFF);
    }

    if (time > 0) { // if a time is given start blinking the led
        var cycles = Math.round(time / 250); //convert time to cycles of 250ms
        MACEA.blinkTimer[group][control] = {};
        MACEA.blinkTimer[group][control].toggle = 0;
        MACEA.blinkTimer[group][control].counter = 0;

        MACEA.blinkTimer[group][control].timer = engine.makeConnection("[App]", "indicator_250ms", function() {
            MACEA.blinkTimer[group][control].counter += 1;

            if (MACEA.blinkTimer[group][control].counter === cycles) {
                MACEA.blinkTimer[group][control].toggle = !MACEA.blinkTimer[group][control].toggle;
                midi.sendShortMsg(0x90, control, MACEA.blinkTimer[group][control].toggle);
                MACEA.blinkTimer[group][control].counter = 0;
            }
        });
    }
};

// Runs every time the focused_effect for a channel is changed either by controller or mixxx
MACEA.handleFxSelect = function(value, group) {
    if (value === 0) {
        MACEA.toggleLED(OFF, group, "fx_sel");
        engine.softTakeoverIgnoreNextValue("[EffectRack1_EffectUnit1]", "super1");
    } else {
        MACEA.toggleLED(ON, group, "fx_sel");
        engine.softTakeoverIgnoreNextValue("[EffectRack1_EffectUnit2_Effect" + value + "]", "meta");
    }
};

// Callback function for handleTraxPress
// previews a track on a quick press and maximize/minimize the library on double press
MACEA.TraxPressCallback = function(_channel, _control, _value, _status, group, event) {
    if (event === QUICK_PRESS) {
        if (engine.getValue("[PreviewDeck1]", "play")) {
            engine.setValue("[PreviewDeck1]", "stop", true);
        } else {
            engine.setValue("[PreviewDeck1]", "LoadSelectedTrackAndPlay", true);
        }
    }
    if (event === DOUBLE_PRESS) {
        script.toggleControl(group, "maximize_library");
    }
    MACEA.traxxPressTimer = 0;
};

// toggles the focussed effect or all effect slots in an effect unit on or off
MACEA.toggleEffect = function(group) {
    var unitNr = script.deckFromGroup(group);
    var effectUnit = "EffectRack1_EffectUnit" + unitNr;
    var effectUnitGroup = "["+effectUnit+"]";
    var focusedEffect = engine.getValue(effectUnitGroup, "focused_effect");
    var enabledFxSlots = [];

    if (focusedEffect === 0) {
        for (var effectSlot = 1; effectSlot <= MACEA.numEffectSlots; effectSlot++) {
            enabledFxSlots.push(engine.getValue("[" + effectUnit + "_Effect" + effectSlot + "]", "enabled"));
        }

        if (enabledFxSlots.indexOf(1) === -1) {
            MACEA.effectSlotState[effectUnitGroup].map(function(state, effect) {
                engine.setValue("[" + effectUnit + "_Effect" + (effect +1) + "]", "enabled", state);
            });
        } else {
            MACEA.effectSlotState[effectUnitGroup] = enabledFxSlots;
            for (effectSlot = 1; effectSlot <= MACEA.numEffectSlots; effectSlot++) {
                engine.setValue("[" + effectUnit + "_Effect" + effectSlot + "]", "enabled", 0);
            }
        }
    } else {
        script.toggleControl("[" + effectUnit + "_Effect" + focusedEffect + "]", "enabled");
    }
};

// ----- functions mapped to buttons -----

// selects the loop in point in loop adjustment mode, otherwise trigger "beatloop_activate"
MACEA.handleLoop = function(_channel, _control, value, _status, group) {
    if (MACEA.adjustLoop[group]) { // loop adjustment mode is active
        if (MACEA.adjustLoopOut[group] && value === DOWN) { // loop out is currently being adjusted, switch to loop in
            MACEA.startLoopAdjust(group, "start");
        } else if (MACEA.adjustLoopIn[group] && value === DOWN) { // loop in is currently being adjusted switch to loop in and out
            MACEA.startLoopAdjust(group);
        }
    } else {
        if (value === DOWN) { // loop adjustment mode is not active
            engine.setValue(group, "beatloop_activate", 1);
        } else {
            engine.setValue(group, "beatloop_activate", 0);
        }
    }
};

// selects the loop out point in loop adjustment mode, otherwise trigger reloop
MACEA.handleReloop = function(_channel, _control, value, _status, group) {
    if (MACEA.adjustLoop[group]) { // loop adjustment mode is active
        if (MACEA.adjustLoopIn[group] && value === DOWN) { // loop in is currently being adjusted, switch to loop out
            MACEA.startLoopAdjust(group, "end");
        } else if (MACEA.adjustLoopOut[group] && value === DOWN) { // loop out is currently being adjusted switch to loop in and out
            MACEA.startLoopAdjust(group);
        }
    } else {
        if (value === DOWN) { // loop adjustment mode is not active
            engine.setValue(group, "reloop_toggle", 1);
        } else {
            engine.setValue(group, "reloop_toggle", 0);
        }
    }
};

// set a loop in point if none is defined, otherwise enable adjustment of the start position with the jogwheel
MACEA.handleLoopIn = function(_channel, _control, value, _status, group) {
    if (MACEA.adjustLoop[group]) { // loop adjustment mode is active
        if (MACEA.adjustLoopOut[group] && value === DOWN) { // loop out is currently being adjusted, switch to loop in
            MACEA.startLoopAdjust(group, "start");
        } else if (MACEA.adjustLoopIn[group] && value === DOWN) { // loop in is currently being adjusted switch to loop in and out
            MACEA.startLoopAdjust(group);
        }
    } else { // loop adjustment mode is not active
        if (value === DOWN) {
            engine.setValue(group, "loop_in", 1);
        } else {
            engine.setValue(group, "loop_in", 0);
        }
    }
};

// set a loop in point if none is defined, otherwise enable adjustment of the start position with the jogwheel
MACEA.handleLoopOut = function(_channel, _control, value, _status, group) {
    if (MACEA.adjustLoop[group]) { // loop adjustment mode is active
        if (MACEA.adjustLoopIn[group] && value === DOWN) { // loop in is currently being adjusted, switch to loop out
            MACEA.startLoopAdjust(group, "end");
        } else if (MACEA.adjustLoopOut[group] && value === DOWN) { // loop out is currently being adjusted switch to loop in and out
            MACEA.startLoopAdjust(group);
        }
    } else {
        if (value === DOWN) { // loop adjustment mode is not active
            engine.setValue(group, "loop_out", 1);
        } else {
            engine.setValue(group, "loop_out", 0);
        }
    }
};

// Toggle play and make sure the preview deck stops when starting to play in a deck
// brake or softStart a while the scratch toggle button is held
MACEA.handlePlay = function(_channel, _control, value, _status, group) {
    var deck = script.deckFromGroup(group);
    if (value === DOWN && MACEA.scratchPressed[group]) { // scratch toggle is pressed
        if (engine.getValue(group, "play") === 0) {
            engine.softStart(deck, true, 1.5);
        } else {
            engine.brake(deck, true, 0.75);
        }
    } else if (value === DOWN) { // scratch toggle is not pressed
        script.toggleControl(group, "play");
    }
};

// Checks wether the Traxx button is double pressed
MACEA.handleTraxPress = function(channel, control, value, status, group) {
    if (value === DOWN) {
        if (MACEA.traxxPressTimer === 0) { // first press
            MACEA.traxxPressTimer = engine.beginTimer(400, function() {
                MACEA.TraxPressCallback(channel, control, value, status, group, QUICK_PRESS);
            }, true);
        } else { // 2nd press (before timer's out)
            engine.stopTimer(MACEA.traxxPressTimer);
            MACEA.TraxPressCallback(channel, control, value, status, group, DOUBLE_PRESS);
        }
    }
};

// select track when turning the Traxx button
MACEA.selectTrack = function(_channel, _control, value, _status, _group) {
    var diff = value - 64; // 0x40 (64) centered control
    engine.setValue("[Playlist]", "SelectTrackKnob", diff);
};

// select playlist when turning the Traxx button
MACEA.selectPlaylist = function(_channel, _control, value, _status, _group) {
    var diff = value - 64; // 0x40 (64) centered control
    engine.setValue("[Playlist]", "SelectPlaylist", diff);
};

// Stops a preview that might be playing and loads the selected track regardless
MACEA.handleTrackLoading = function(_channel, _control, value, _status, group) {
    if (value === DOWN) {
        engine.setValue("[PreviewDeck1]", "stop", true);
        engine.setValue(group, "LoadSelectedTrack", true);
    }
};

// Cycle through the effectslots of the effectunit that corresponds to a channel
MACEA.nextEffect = function(_channel, _control, value, _status, group) {
    var unitNr = script.deckFromGroup(group);
    var controlString = "[EffectRack1_EffectUnit" + unitNr + "]";
    if (value === DOWN) {
        if (engine.getValue(controlString, "focused_effect") === MACEA.numEffectSlots) { // after cycling through all effectslot go back to the start
            for (var i = 1; i === MACEA.numEffectSlots; i++) {
                var groupString = "[EffectRack1_EffectUnit" + unitNr + "_Effect" + i + "]";
                engine.softTakeoverIgnoreNextValue(groupString, "meta");
            }
            engine.softTakeoverIgnoreNextValue(controlString, "super1");
            engine.setValue(controlString, "focused_effect", 0);
        } else { // next effect slot
            var currentSelection = engine.getValue(controlString, "focused_effect");
            engine.setValue(controlString, "focused_effect", currentSelection + 1);
        }
    }
};

// Handle turning of the Dry/Wet nob
// control the dry/wet when no effect slot is selected else selects the effect for the currently selected effect slot
MACEA.handleEffectDryWet = function(_channel, _control, value, _status, group) {
    var unitNr = script.deckFromGroup(group);
    var controlString = "[EffectRack1_EffectUnit" + unitNr + "]";
    var diff = (value - 64); // 0x40 (64) centered control
    if (MACEA.dryWetPressed[group]) {
        engine.setValue(controlString, "chain_preset_selector", diff);
    } else if (engine.getValue(controlString, "focused_effect") === 0) { // no effect slot is selected
        var dryWetValue = engine.getValue(controlString, "mix");
        engine.setValue(controlString, "mix", dryWetValue + (diff / 16.0));
    } else {
        var focussedEffect = engine.getValue(controlString, "focused_effect");
        engine.setValue("[EffectRack1_EffectUnit" + unitNr + "_Effect" + focussedEffect + "]", "effect_selector", diff);
    }
};

// Turns a currently selected effect slot on, if none are selected all effect slots are turned off
MACEA.handleDryWetPressed = function(_channel, _control, value, _status, group) {
    if (value === DOWN) {
        MACEA.dryWetPressed[group] = true;
        MACEA.dryWetPressTimer = engine.beginTimer(400, function() {
            MACEA.dryWetPressTimer = 0;
        }, true);
    } else {
        MACEA.dryWetPressed[group] = false;
        if (MACEA.dryWetPressTimer !== 0) {
            engine.stopTimer(MACEA.dryWetPressTimer);
            MACEA.dryWetPressTimer = 0;
            MACEA.toggleEffect(group);
        }
    }
};

// Controls the meta for an effect slot if selected, otherwise controls the meta for an effect unit
MACEA.handleFxAmount = function(_channel, _control, value, _status, group) {
    var unitNr = script.deckFromGroup(group);
    var controlString = "[EffectRack1_EffectUnit" + unitNr + "]";
    var focussedEffect = engine.getValue(controlString, "focused_effect");
    if (focussedEffect === 0) { // no effect slot is selected
        engine.setValue(controlString, "super1", value / 127);
    } else {
        engine.setValue("[EffectRack1_EffectUnit" + unitNr + "_Effect" + focussedEffect + "]", "meta", value / 127);
    }
};

// Turn off any effect units that are enabled for the channel, if none are enabled enable the corresponding effect unit
MACEA.handleFxPress = function(_channel, _control, value, _status, group) {
    if (value === DOWN) {
        var fxChannel = "group_" + group + "_enable";
        var unitNr = script.deckFromGroup(group);
        var enabledFxGroups = [];

        for (var i = 1; i <= MACEA.numEffectUnits; i++) {
            enabledFxGroups.push(engine.getValue("[EffectRack1_EffectUnit" + i + "]", fxChannel));
        }

        if (enabledFxGroups.indexOf(1) !== -1) {
            for (var effectUnit = 1; effectUnit <= MACEA.numEffectUnits; effectUnit++) {
                engine.setValue("[EffectRack1_EffectUnit" + effectUnit + "]", fxChannel, false);
            }
        } else {
            engine.setValue("[EffectRack1_EffectUnit" + unitNr + "]", fxChannel, true);
        }
    }
};

// This function is necessary to allow for soft takeover of the filter amount button
// see https://github.com/mixxxdj/mixxx/wiki/Midi-Scripting#soft-takeover
MACEA.handleFilter = function(_channel, _control, value, _status, group) {
    engine.setValue("[QuickEffectRack1_"+ group +"]", "super1", value / 127);
};

// Handles setting soft takeovers when pressing shift
MACEA.handleShift = function(_channel, _control, value, _status, group) {
    if (value === DOWN) {
        var unitNr = script.deckFromGroup(group);
        engine.softTakeoverIgnoreNextValue("[QuickEffectRack1_"+group+"]", "super1");
        engine.softTakeoverIgnoreNextValue("[EffectRack1_EffectUnit"+unitNr+"]", "super1");
    }
};

// The "disc" button that enables/disables scratching
MACEA.scratchToggle = function(_channel, _control, value, _status, group) {
    if (value === DOWN) {
        MACEA.scratchPressed[group] = true;
        MACEA.scratchTogglePressTimer = engine.beginTimer(400, function() {
            MACEA.scratchTogglePressTimer = 0;
        }, true);
    } else {
        MACEA.scratchPressed[group] = false;
        if (MACEA.scratchTogglePressTimer !== 0) {
            engine.stopTimer(MACEA.scratchTogglePressTimer);
            MACEA.scratchTogglePressTimer = 0;
            MACEA.stopLoopAdjust(group);
            MACEA.scratchToggleState[group] = !MACEA.scratchToggleState[group];
            MACEA.toggleLED(MACEA.scratchToggleState[group], group, "scratch_active");
            if (MACEA.scrollToggleState[group]) {
                MACEA.scrollToggleState[group] = !MACEA.scrollToggleState[group];
                MACEA.toggleLED(MACEA.scrollToggleState[group], group, "scroll_active");
            }
        }
    }
};

// The "loupe" button that enables/disables track scrolling
MACEA.scrollToggle = function(_channel, _control, value, _status, group) {
    if (value === DOWN) {
        MACEA.stopLoopAdjust(group);
        MACEA.scrollToggleState[group] = !MACEA.scrollToggleState[group];
        MACEA.toggleLED(MACEA.scrollToggleState[group], group, "scroll_active");
        if (MACEA.scratchToggleState[group]) {
            MACEA.scratchToggleState[group] = !MACEA.scratchToggleState[group];
            MACEA.toggleLED(MACEA.scratchToggleState[group], group, "scratch_active");
        }
    }
};

// The touch function on the wheels that enables/disables scratching
MACEA.wheelTouch = function(_channel, _control, value, _status, group) {
    var unitNr = script.deckFromGroup(group);

    if (value === DOWN) {
        MACEA.wheelTouched[group] = true;
    } else {
        MACEA.wheelTouched[group] = false;
    }

    if (MACEA.scratchByWheelTouch || MACEA.scratchToggleState[group]) {
        if (value === DOWN) {
            var alpha = 1.0 / 8.0;
            var beta = alpha / 32.0;
            engine.scratchEnable(unitNr, MACEA.scratchTicksPerRevolution, 33.33, alpha, beta);
        } else {
            engine.scratchDisable(unitNr);
        }
    }
};

// The wheel that controls the scratching / jogging
MACEA.wheelTurn = function(_channel, _control, value, _status, group) {
    var deckNr = script.deckFromGroup(group);
    var diff = value - 64; // 0x40 (64) centered control
    if (MACEA.adjustLoop[group]) {  // loop adjustment
        // triple the adjustment rate if the top of the jogwheel is being touched
        var factor = MACEA.wheelTouched[group] ? 100 : 33;
        if (MACEA.adjustLoopIn[group]) {
            var newStartPosition = engine.getValue(group, "loop_start_position") + (diff * factor);
            if (newStartPosition < engine.getValue(group, "loop_end_position")) {
                engine.setValue(group, "loop_start_position", newStartPosition);
            }
        }
        if (MACEA.adjustLoopOut[group]) {
            var newEndPosition = engine.getValue(group, "loop_end_position") + (diff * factor);
            if (newEndPosition > engine.getValue(group, "loop_start_position")) {
                engine.setValue(group, "loop_end_position", newEndPosition);
            }
        }
    } else if (MACEA.scratchByWheelTouch || MACEA.scratchToggleState[group] || MACEA.scrollToggleState[group]) {
        if (MACEA.scrollToggleState[group]) { // scroll deck
            // triple the scroll rate if the top of the jogwheel is being touched
            var speedFactor = MACEA.wheelTouched[group] ? 0.00020 : 0.000066;
            var currentPosition = engine.getValue(group, "playposition");
            engine.setValue(group, "playposition", currentPosition + speedFactor * diff * MACEA.jogWheelScrollSpeed);
        } else if (MACEA.wheelTouched[group]) {
            engine.scratchTick(deckNr, diff); // scratch deck
        } else {
            engine.setValue(group, "jog", diff); // pitch bend deck
        }
    }
};

// stop or start loop adjustment mode
MACEA.handleBeatLoopPress = function(_channel, _control, value, _status, group) {
    if (MACEA.adjustLoop[group] && value === DOWN) {
        MACEA.stopLoopAdjust(group);
    } else if (value === DOWN && engine.getValue(group, "loop_start_position") !== -1 && engine.getValue(group, "loop_end_position") !== -1) {
        MACEA.adjustLoop[group] = true;
        MACEA.startLoopAdjust(group);
    }
};

// move the track or an active loop "beatjump_size" number of beats
MACEA.handleBeatMove = function(_channel, _control, value, _status, group) {
    var beatjumpSize = (value - 64) * engine.getValue(group, "beatjump_size");
    engine.setValue(group, "beatjump", beatjumpSize);
};

// clears a loop on a short press, set internal variable to true to adjust "beatjump_size"
MACEA.handleLoopLengthPress = function(_channel, _control, value, _status, group) {
    if (value === DOWN) {
        MACEA.loopLengthPressed[group] = true;
        MACEA.loopLengthPressTimer = engine.beginTimer(400, function() {
            MACEA.loopLengthPressTimer = 0;
        }, true);
    } else {
        MACEA.loopLengthPressed[group] = false;
        if (MACEA.loopLengthPressTimer !== 0) {
            engine.stopTimer(MACEA.loopLengthPressTimer);
            MACEA.loopLengthPressTimer = 0;
            if (MACEA.adjustLoop[group]) {
                MACEA.stopLoopAdjust(group);
            }
            MACEA.clearLoop(_channel, _control, value, _status, group);
        }
    }
};

// changes the loop length if Mixage.loopLengthPressed[group] is false otherwise adjusts the "beatjump_size"
MACEA.handleLoopLength = function(_channel, _control, value, _status, group) {
    var diff = (value - 64); // 0x40 (64) centered control
    if (MACEA.loopLengthPressed[group]) {
        var beatjumpSize = engine.getParameter(group, "beatjump_size");
        var newBeatJumpSize = diff > 0 ? 2 * beatjumpSize : beatjumpSize / 2;
        engine.setParameter(group, "beatjump_size", newBeatJumpSize);
    } else {
        var loopScale = diff > 0 ? "loop_double" : "loop_halve";
        engine.setValue(group, loopScale, true);
    }
};
