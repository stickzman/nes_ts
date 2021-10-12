/// <reference path="helper.ts" />
/// <reference path="input.ts" />

//Initialize NES
let nes: NES;
var scale: number;
let input: Input = new Input();

//Check refresh rate of monitor, limit fps if applicable
function checkRefreshRate() {
    const numFrames = 15 // First 5 frames are dropped
    let i = numFrames
    let time = performance.now()
    let timeDeltas = []

    window.requestAnimationFrame(check)
    function check() {
        i--
        if (i > numFrames - 5) {
            // Ignore first 5 frames to let framerate settle out
            time = performance.now()
            window.requestAnimationFrame(check)
        } else if (i >= 0) {
            let t = performance.now()
            timeDeltas.push(t - time)
            time = t
            window.requestAnimationFrame(check)
        } else {
            const ms = timeDeltas.reduce((sum, a) => sum + a, 0)/timeDeltas.length
            if (ms < 15.5) NES.limitFPS = true // Limit framerate if over 64fps
        }
    }

}

window.onbeforeunload = function () {
    if (nes !== undefined) {
        saveRAM();
        nes.storeState();
    }
    sessionStorage.setItem("volume", $("#volume").val().toString());
    sessionStorage.setItem("scale", PPU.scale.toString());
    sessionStorage.setItem("frameskip", NES.maxFrameSkip.toString());
    localStorage.setItem("saveWarn", (NES.saveWarn) ? "1" : "0");
}

var compPass = checkComp();
$(document).ready(function() {
    if (!compPass) return;

    checkRefreshRate();

    //Check little/big endianness of Uint32
    let buff = new ArrayBuffer(8);
    let view32 = new Uint32Array(buff);
    view32[1] = 0x0A0B0C0D;
    PPU.isLittleEndian = true;
    if (buff[4] === 0x0A && buff[5] === 0x0B && buff[6] === 0x0C && buff[7] === 0x0D) {
        PPU.isLittleEndian = false;
    }

    //Set the save state warning indicator
    NES.saveWarn = (localStorage.getItem("saveWarn") == "0") ? false : true;
    $("#warningFlag").prop("checked", NES.saveWarn);

    //Set up APU/Web Audio API
    if (audioEnabled) {
        let a = new AudioContext();
        APU.masterGain = a.createGain();
        APU.masterGain.connect(a.destination);
        let osc = a.createOscillator();
        osc.type = "triangle";
        let g = a.createGain();
        osc.connect(g);
        g.connect(APU.masterGain);
        APU.triangle = new TriangleChannel(osc, g);
        osc = a.createOscillator();
        osc.type = "square";
        g = a.createGain();
        osc.connect(g);
        g.connect(APU.masterGain);
        APU.pulse1 = new PulseChannel(osc, g);
        osc = a.createOscillator();
        osc.type = "square";
        g = a.createGain();
        osc.connect(g);
        g.connect(APU.masterGain);
        APU.pulse2 = new PulseChannel(osc, g, false);
        let o = a.createNoiseSource();
        g = a.createGain();
        o.connect(g);
        g.connect(APU.masterGain);
        APU.noise = new NoiseChannel(o, g);
    } else {
        $("#audioWarning").css("display", "inline-block");
        $("#volumeDiv").css("display", "none");
    }

    //Check for existing volume settings
    if (audioEnabled) {
        if (sessionStorage.getItem("volume") === null) {
            updateVol(0.25); //Set initial volume to 25% (50% of the UI's max)
        } else {
            let vol = parseFloat(sessionStorage.getItem("volume"));
            $("#volume").val(vol);
            updateVol(vol);
        }
    }

    //Create canvas
    PPU.canvas = (<HTMLCanvasElement>$("#screen")[0]);
    //Check for existing scale settings
    if (sessionStorage.getItem("scale") == null) {
        PPU.updateScale(2);
    } else {
        let s = parseInt(sessionStorage.getItem("scale"));
        PPU.updateScale(s);
        $("#scale").val(PPU.scale);
    }
    //Check for existing frameskip settings
    if (sessionStorage.getItem("frameskip") != null) {
        NES.maxFrameSkip = parseInt(sessionStorage.getItem("frameskip"));
        $("#frameskip").val(NES.maxFrameSkip);
    }

    $("#scale").change(function() {
        PPU.updateScale(parseInt((<HTMLSelectElement>$("#scale")[0]).value));
    });
    $("#frameskip").change(function() {
        NES.maxFrameSkip = parseInt((<HTMLSelectElement>$("#frameskip")[0]).value);
    });
    $("#reset-btn").on("click", function () {
        if (nes !== undefined) nes.reset();
        this.blur();
    });

    //Mute audio when webpage is hidden
    $(document).on('visibilitychange', function() {
        if (!audioEnabled) return;
        if (document.hidden) {
            APU.masterGain.gain.setTargetAtTime(0, 0, 0.05);
        } else {
            APU.masterGain.gain.setTargetAtTime(APU.masterVol, 0, 0.5);
        }
    });

    //Set up relevant button listeners
    $(document).on("keydown", function (e) {
        if (input.setBtn(e.keyCode, true)) {
            e.preventDefault();
        }
    });
    $(document).on("keyup", function (e) {
        if (input.setBtn(e.keyCode, false)) {
            e.preventDefault();
        }
    });

    //Set up fullscreen listener
    $("#screen").dblclick(function () {
        if (this.webkitRequestFullscreen) {
            this.webkitRequestFullscreen();
        } else if (this.requestFullscreen) {
            this.requestFullscreen();
        } else if (this.mozRequestFullScreen) {
            this.mozRequestFullScreen();
        }
    });

    if (document.onwebkitfullscreenchange !== undefined) {
        document.onwebkitfullscreenchange =  function () {
            checkFullscreen(document.webkitFullscreenElement);
        };
    } else if (document.onfullscreenchange !== undefined) {
        document.onfullscreenchange = function () {
            checkFullscreen(document.fullscreenElement);
        };
    } else if (document.onmozfullscreenchange !== undefined) {
        document.onmozfullscreenchange = function () {
            checkFullscreen(document.mozFullScreenElement);
        };
    }

    //Build the button mapping control table
    input.buildControlTable($("#p1Controls"));
    input.buildControlTable($("#p2Controls"), false);

    //Set up event listener for file picker to launch ROM
    $('#file-input').change(function (e:any) {
        init(e.target.files[0]);
    });
});

//Save any battery-backed RAM
function saveRAM() {
    if (!nes.rom.batteryBacked) return;
    localStorage.setItem(nes.rom.id, nes.mainMemory.slice(0x6000, 0x8000).toString());
}

function fileDropHandler(e) {
    e.preventDefault();
    init(e.dataTransfer.files[0]);
}

function checkFullscreen(fullscreenElem) {
    if (fullscreenElem === null) {
        //Exiting fullscreen, return to normal scale
        PPU.updateScale(scale);
    } else {
        //Entering fullscreen, adjust scale and store old value
        scale = PPU.scale;
        let s = Math.min($(window).width()/256, $(window).height()/240);
        PPU.updateScale(Math.floor(s));
    }
}

function init(file) {
    if (!file) {
        return;
    }
    if (nes !== undefined) {
        window.cancelAnimationFrame(nes.lastAnimFrame);
        saveRAM();
        nes.storeState();
    } else if (audioEnabled) {
        //Start the oscillators after the user chooses a file
        //Complies with Chrome's upcoming Web Audio API autostart policy
        APU.noise.osc.start(0);
        APU.triangle.osc.start(0);
        APU.pulse1.osc.start(0);
        APU.pulse2.osc.start(0);
    }
    let reader = new FileReader();
    reader.onload = function(e) {
        nes = new NES(new Uint8Array(<ArrayBufferLike>e.target.result), input);
        nes.boot();
    }
    reader.readAsArrayBuffer(file);
}
