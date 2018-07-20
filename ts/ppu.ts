class PPU {
    public mem: Uint8Array;
    private OAM: Uint8Array;
    private cpuMem: Uint8Array;

    private oddFrame: boolean = false;
    private latch = false;
    private vRamAddr: number;
    private scanline: number = 261;
    private dot: number = 0;
    //Render vars
    private addrOffset: number = 0;
    private addr: number;
    private ntLatch: number;
    private atLatch: number;
    private bkgHiLatch: number;
    private bkgLoLatch: number;

    //Drawing to screen
    private pixelPointer = {
        x: 0,
        y: 0,
        size: 1
    };

    //CTRL vars
    private baseNTAddr: number = 0x2000;
    private incAddrBy32: boolean = false; //If false, inc by 1
    private spritePatAddr: number = 0;
    private bkgPatAddr: number = 0;
    private sprite8x16: boolean = false; //If false, sprite size is 8x8
    private masterSlave: boolean = false;
    private vBlankNMI: boolean = false;
    //MASK vars
    private greyscale: boolean = false;
    private showLeftBkg: boolean = false;
    private showLeftSprite: boolean = false;
    private showBkg: boolean = false;
    private showSprites: boolean = false;
    private maxRed: boolean = false;
    private maxGreen: boolean = false;
    private maxBlue: boolean = false;
    //STATUS vars
    private vbl: boolean = false;

    private readonly PPUCTRL: number = 0x2000;
    private readonly PPUMASK: number = 0x2001;
    private readonly PPUSTATUS: number = 0x2002;
    private readonly OAMADDR: number = 0x2003;
    private readonly OAMDATA: number = 0x2004;
    private readonly PPUSCROLL: number = 0x2005;
    private readonly PPUADDR: number = 0x2006;
    private readonly PPUDATA: number = 0x2007;
    private readonly OAMDMA: number = 0x4014;


    constructor(mainMemory: Uint8Array) {
        this.mem = new Uint8Array(0x4000);
        this.OAM = new Uint8Array(0x100);
        this.cpuMem = mainMemory;
    }

    public boot() {
        this.cpuMem[this.PPUCTRL] = 0;
        this.cpuMem[this.PPUMASK] = 0;
        this.cpuMem[this.PPUSTATUS] = 0xA0;
        this.cpuMem[this.OAMADDR] = 0;
        this.cpuMem[this.PPUSCROLL] = 0;
        this.cpuMem[this.PPUADDR] = 0;
        this.cpuMem[this.PPUDATA] = 0;
        this.oddFrame = false;
    }

    public reset() {
        this.cpuMem[this.PPUCTRL] = 0;
        this.cpuMem[this.PPUMASK] = 0;
        this.cpuMem[this.PPUSCROLL] = 0;
        this.cpuMem[this.PPUDATA] = 0;
        this.oddFrame = false;
    }

    public cycle() {
        switch (true) {
            case (this.scanline < 240):
                this.visibleCycle();
                break;
            case (this.scanline < 260):
                //POST-RENDER
                break;
            case (this.scanline == 261):
                //PRE-RENDER
                break;
        }
        if (++this.dot > 340) {
            this.dot = 0;
            if (++this.scanline > 261) {
                this.scanline = 0;
                this.oddFrame = !this.oddFrame;
            }
        }
    }

    public visibleCycle() {
        if (this.oddFrame && this.scanline == 0 && this.dot == 0) {
            this.dot++;
        }
        if (this.dot == 0) return;
        switch (true) {
            case (this.dot < 257 || (this.dot > 320 && this.dot <= 336)):
                switch (this.dot % 8) {
                    case 1: this.addr = this.baseNTAddr + this.addrOffset; break;
                    case 2: this.ntLatch = this.mem[this.addr]; break;
                    case 3: this.addr = this.baseNTAddr + 0x3C0 + Math.floor(this.addrOffset/15); break;
                    case 4: this.atLatch = this.mem[this.addr]; break;
                    case 5: this.addr = this.ntLatch; break;
                    case 6: this.bkgLoLatch = this.mem[this.addr]; break;
                    case 7: this.addr += 8; break;
                    case 0: this.bkgHiLatch = this.mem[this.addr]; this.render(); break;
                }
                break;
            case (this.dot < 321):
                //TODO: Get sprites for *next* scanline HERE
                break;
        }

    }

    public render() {
        //Combine the hi and lo pattern tables into an array of nibbles
        let hi = this.bkgHiLatch.toString(2);
        let lo = this.bkgLoLatch.toString(2);
        let pStr = [""];
        for (let i = 0; i < hi.length; i++) {
            pStr[0] += hi[i] + lo[i] + ",";
        }
        pStr = pStr[0].split(",");
        let pByte;
        for (let i = 0; i < pStr.length; i++) {
            pByte[i] = parseInt(pByte[i], 2);
        }
        
    }

    public readReg(addr: number) {
        switch (addr) {
            case this.PPUSTATUS:
                this.latch = false;
                //this.cpuMem[addr] = (this.cpuMem[addr] & 0x7F);
                break;
        }
    }

    public writeReg(addr: number) {
        let byte = this.cpuMem[addr];
        switch (addr) {
            case this.PPUCTRL:
                let ntBit = byte & 3;
                switch (ntBit) {
                    case 0: this.baseNTAddr = 0x2000; break;
                    case 1: this.baseNTAddr = 0x2400; break;
                    case 2: this.baseNTAddr = 0x2800; break;
                    case 3: this.baseNTAddr = 0x2C00; break;
                }
                this.incAddrBy32 = (byte & 4) == 1;
                if ((byte & 8) == 1) {
                    this.spritePatAddr = 0x1000;
                } else {
                    this.spritePatAddr = 0;
                }
                if ((byte & 16) == 1) {
                    this.bkgPatAddr = 0x1000;
                } else {
                    this.bkgPatAddr = 0;
                }
                this.sprite8x16 = (byte & 32) == 1;
                this.masterSlave = (byte & 64) == 1;
                this.vBlankNMI = (byte & 128) == 1;
                break;
            case this.PPUMASK:
                this.greyscale = (byte & 1) == 1;
                this.showLeftBkg = (byte & 2) == 1;
                this.showLeftSprite = (byte & 4) == 1;
                this.showBkg = (byte & 8) == 1;
                this.showSprites = (byte & 16) == 1;
                this.maxRed = (byte & 32) == 1;
                this.maxGreen = (byte & 64) == 1;
                this.maxBlue = (byte & 128) == 1;
                break;
            case this.PPUADDR:
                if (!this.latch) {
                    this.vRamAddr = byte << 8;
                } else {
                    this.vRamAddr += byte;
                }
                this.latch = !this.latch;
                break;
            case this.PPUDATA:
                this.mem[this.vRamAddr] = byte;
                if (this.incAddrBy32) {
                    this.vRamAddr += 32;
                } else {
                    this.vRamAddr += 1;
                }
                break;
        }
    }

    private setVBL() {
        this.vbl = true;
        this.mem[this.PPUSTATUS] |= 128;
    }

    private clearVBL() {
        this.vbl = false;
        this.mem[this.PPUSTATUS] &= 0x7F;
    }
}
