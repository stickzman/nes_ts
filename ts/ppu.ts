class PPU {
    public mem: Uint8Array;
    public OAM: Uint8Array;
    private oamAddr: number;

    private oddFrame: boolean = false;
    private writeLatch = false;
    private vRamAddr: number = 0;
    private initRamAddr: number = 0;
    private scanline: number = 261;
    private dot: number = 0;

    //Shift registers
    private bkgQ = [];
    private attrQ = [];

    //CTRL vars
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


    private ctx = null;
    private imageData = null;

    constructor(private nes: NES, canvas: HTMLCanvasElement) {
        this.mem = new Uint8Array(0x4000);
        this.OAM = new Uint8Array(0x100);
        let ctx = canvas.getContext("2d");
        ctx.imageSmoothingEnabled = false;
        ctx.mozImageSmoothingEnabled = false;
        ctx.webkitImageSmoothingEnabled = false;
        let imgData = ctx.createImageData(canvas.width, canvas.height);
        this.ctx = ctx;
        for (let i = 3; i < imgData.data.length; i += 4) {
            imgData.data[i] = 255;
        }
        this.imageData = imgData;
    }

    private setPixel (r: number, g: number, b: number) {
        if (this.maxGreen || this.maxBlue) {
            r -= 25;
        }
        if (this.maxRed || this.maxBlue) {
            g -= 25;
        }
        if (this.maxRed || this.maxGreen) {
            b -= 25;
        }
        let i = this.scanline * this.imageData.width * 4 + this.dot * 4;
        this.imageData.data[i++] = r;
        this.imageData.data[i++] = g;
        this.imageData.data[i++] = b;
    }

    public paintFrame () {
        this.ctx.putImageData(this.imageData, 0, 0);
    }

    public boot() {
        this.nes.write(this.PPUCTRL, 0);
        this.nes.write(this.PPUMASK, 0);
        this.nes.write(this.PPUSTATUS, 0xA0);
        this.nes.write(this.OAMADDR, 0);
        this.nes.write(this.PPUSCROLL, 0);
        this.nes.write(this.PPUADDR, 0);
        this.nes.write(this.PPUDATA, 0);
        this.oddFrame = false;
    }

    public reset() {
        this.nes.write(this.PPUCTRL, 0);
        this.nes.write(this.PPUMASK, 0);
        this.nes.write(this.PPUSCROLL, 0);
        this.nes.write(this.PPUDATA, 0);
        this.oddFrame = false;
    }

    public cycle() {
        switch (true) {
            case (this.scanline < 240):
                this.visibleCycle();
                break;
            case (this.scanline < 260):
                if (this.scanline == 241 && this.dot == 1 && this.nes.cpu.cycleCount > 29658) this.setVBL();
                //POST-RENDER
                break;
            case (this.scanline == 261):
                //PRE-RENDER
                if (this.dot == 1) {
                    this.clearVBL();
                    this.clearSprite0();
                    this.clearOverflow();
                } else if (this.dot == 328) {
                    //Get attrTable byte
                    this.attrQ[0] = this.mem[this.getATAddr()];
                    let addr = this.mem[this.getNTAddr()] << 4;
                    //Get Low BG byte
                    let lo = this.mem[addr + this.bkgPatAddr];
                    //Get High BG byte
                    let hi = this.mem[addr + 8 + this.bkgPatAddr];
                    this.bkgQ[0] = this.combinePatData(hi, lo);

                    if (this.showBkg) this.incCoarseX();
                } else if (this.dot == 336) {
                    //Get attrTable byte
                    this.attrQ[1] = this.mem[this.getATAddr()];
                    let addr = this.mem[this.getNTAddr()] << 4;
                    //Get Low BG byte
                    let lo = this.mem[addr + this.bkgPatAddr];
                    //Get High BG byte
                    let hi = this.mem[addr + 8 + this.bkgPatAddr];
                    this.bkgQ[1] = this.combinePatData(hi, lo);

                    if (this.showBkg) this.incCoarseX();
                }
                break;
        }
        if (++this.dot > 340) {
            this.dot = 0;
            if (++this.scanline > 261) {
                this.scanline = 0;
                this.oddFrame = !this.oddFrame;
            }
        }
        //Reset pointers
        if (this.dot == 1 && this.scanline == 261) {
            if (this.showBkg) this.vRamAddr = this.initRamAddr;
        }

        if (this.scanline == 239 && this.dot == 256) {
            NES.drawFrame = true;
        }
    }

    public visibleCycle() {
        if (!this.showBkg) {
            if (this.dot < 256) {
                this.render();
            }
            return;
        }
        switch (true) {
            case (this.dot <= 256):
                if (this.dot < 256) {
                    this.render();
                }
                if (this.dot % 8 == 0 && this.dot != 0) {
                    //Get attrTable byte
                    this.attrQ[1] = this.mem[this.getATAddr()];
                    let addr = this.mem[this.getNTAddr()] << 4;
                    //Get Low BG byte
                    let lo = this.mem[addr + this.scanline % 8 + this.bkgPatAddr];
                    //Get High BG byte
                    let hi = this.mem[addr + 8 + this.scanline % 8 + this.bkgPatAddr];

                    this.bkgQ[1] = this.combinePatData(hi, lo);

                    //Inc NT Pointer
                    if (this.dot < 256) {
                        this.incCoarseX();
                    } else {
                        this.resetCoarseX();
                        if (this.scanline % 8 == 7) {
                            this.incCoarseY();
                            if (this.scanline == 239) {
                                this.resetCoarseY();
                            }
                        }
                    }
                }
                break;
            case (this.dot <= 320):
                //TODO: Sprite Evaluation
                break;
            case (this.dot == 328):{
                //Get attrTable byte
                this.attrQ[0] = this.mem[this.getATAddr()];
                let addr = this.mem[this.getNTAddr()] << 4;

                let y = (this.scanline + 1) % 8;
                //Get Low BG byte
                let lo = this.mem[addr + y + this.bkgPatAddr];
                //Get High BG byte
                let hi = this.mem[addr + 8 + y + this.bkgPatAddr];

                this.bkgQ[0] = this.combinePatData(hi, lo);

                if (this.showBkg) this.incCoarseX();
                break;
            }
            case (this.dot == 336): {
                //Get attrTable byte
                this.attrQ[1] = this.mem[this.getATAddr()];
                let addr = this.mem[this.getNTAddr()] << 4;

                let y = (this.scanline + 1) % 8;
                //Get Low BG byte
                let lo = this.mem[addr + y + this.bkgPatAddr];
                //Get High BG byte
                let hi = this.mem[addr + 8 + y + this.bkgPatAddr];

                this.bkgQ[1] = this.combinePatData(hi, lo);
                if (this.showBkg) this.incCoarseX();
                break;
            }
        }
    }

    public render() {
        if (!this.showBkg) {
            //Get Universal Background Color and paint a blank pixel
            let palData = this.mem[0x3F00] & 0x3F;
            let col = colorData[palData];
            this.setPixel(col.r, col.g, col.b);
            return;
        }
        //Get PALETTE NUMBER
        let quad: number;
        if (this.dot % 32 < 16) {
            quad = (this.scanline % 32 < 16) ? 0 : 2;
        } else {
            quad = (this.scanline % 32 < 16) ? 1 : 3;
        }
        let palNum: number;
        let mask = 3 << (quad * 2);
        palNum = (this.attrQ[0] & mask) >> (quad * 2);
        let x = this.dot % 8;
        let palInd = 0x3F00 + palNum * 4 + this.bkgQ[0][x];
        let palData = this.mem[palInd] & 0x3F;
        if (this.greyscale) palData &= 0x30;
        let col = colorData[palData];
        this.setPixel(col.r, col.g, col.b);

        if (x % 8 == 7) {
            this.bkgQ[0] = this.bkgQ[1];
            this.bkgQ[1] = null;
            this.attrQ[0] = this.attrQ[1];
            this.attrQ[1] = null;
        }
    }

    public readReg(addr: number): number {
        switch (addr) {
            case this.PPUSTATUS:
                this.writeLatch = false;
                break;
            case this.OAMDATA:
                return this.OAM[this.oamAddr];
        }
        return;
    }

    public writeReg(addr: number) {
        let byte = this.nes.mainMemory[addr];
        switch (addr) {
            case this.PPUCTRL:
                let ntBit = byte & 3;
                this.initRamAddr = insertInto(this.initRamAddr, ntBit, 12, 2, 0);
                this.incAddrBy32 = (byte & 4) != 0;
                if ((byte & 8) != 0) {
                    this.spritePatAddr = 0x1000;
                } else {
                    this.spritePatAddr = 0;
                }
                if ((byte & 16) != 0) {
                    this.bkgPatAddr = 0x1000;
                } else {
                    this.bkgPatAddr = 0;
                }
                this.sprite8x16 = (byte & 32) != 0;
                this.masterSlave = (byte & 64) != 0;
                this.vBlankNMI = (byte & 128) != 0;
                break;
            case this.PPUMASK:
                this.greyscale = (byte & 1) != 0;
                this.showLeftBkg = (byte & 2) != 0;
                this.showLeftSprite = (byte & 4) != 0;
                this.showBkg = (byte & 8) != 0;
                this.showSprites = (byte & 16) != 0;
                this.maxRed = (byte & 32) != 0;
                this.maxGreen = (byte & 64) != 0;
                this.maxBlue = (byte & 128) != 0;
                break;
            case this.PPUADDR:
                if (!this.writeLatch) {
                    this.initRamAddr = byte << 8;
                } else {
                    this.initRamAddr += byte;
                    this.vRamAddr = this.initRamAddr;
                }
                this.writeLatch = !this.writeLatch;
                break;
            case this.PPUDATA:
                if (this.vRamAddr >= 0x2000 && this.vRamAddr <= 0x3000) {
                    if (this.nes.rom.mirrorVertical) {
                        this.mem[this.vRamAddr] = byte;
                        if (this.vRamAddr < 0x2800) {
                            this.mem[this.vRamAddr + 0x800] = byte;
                        } else {
                            this.mem[this.vRamAddr - 0x800] = byte;
                        }
                    } else {
                        this.mem[this.vRamAddr] = byte;
                        if ((this.vRamAddr - 0x2000) % 0x800 < 0x400) {
                            this.mem[this.vRamAddr + 0x400] = byte;
                        } else {
                            this.mem[this.vRamAddr - 0x400] = byte;
                        }
                    }
                } else {
                    this.mem[this.vRamAddr] = byte;
                }
                if (this.incAddrBy32) {
                    this.vRamAddr += 32;
                } else {
                    this.vRamAddr += 1;
                }
                break;
            case this.OAMADDR:
                this.oamAddr = byte;
                break;
            case this.OAMDATA:
                this.OAM[this.oamAddr++] = byte;
                if (this.oamAddr > 0xFF) this.oamAddr = 0;
                break;
            case this.OAMDMA:
                let slice = this.nes.mainMemory.slice((byte << 8), ((byte + 1) << 8));
                this.OAM.set(slice, 0);
                //Catch up to the 514 CPU cycles used
                for (let i = 0; i < 514 * 3; i++) {
                    this.cycle();
                }
                break;
            case this.PPUSCROLL:
                //console.log("scroll", byte.toString(16));
                if (!this.writeLatch) {
                    this.initRamAddr = insertInto(this.initRamAddr, byte, 5, 8, 3);
                } else {
                    this.initRamAddr = insertInto(this.initRamAddr, byte, 15, 3, 0);
                    this.initRamAddr = insertInto(this.initRamAddr, byte, 10, 8, 3);
                }
                this.writeLatch = !this.writeLatch
                break;
        }
    }

    private combinePatData(hi: number, lo: number): number[] {
        let pByte = [];
        let mask: number;
        for (let i = 0; i < 8; i++) {
            mask = 1 << (7 - i);
            if (i > 6) {
                pByte[i] = ((hi & mask) << 1) +
                                (lo & mask);
            } else {
                pByte[i] = ((hi & mask) >> (6 - i)) +
                                ((lo & mask) >> (7 - i));
            }
        }
        return pByte;
    }

    private incCoarseX() {
        if ((this.vRamAddr & 0x1F) == 31) {
            //Swap nametable, horizontally
            this.vRamAddr &= 0xFFE0; //Set X to 0
            this.vRamAddr ^= 0x400; //Swap NT
        } else {
            this.vRamAddr++;
        }
    }

    private resetCoarseX() {
        this.vRamAddr = insertInto(this.vRamAddr, this.initRamAddr, 5, 5, 0);
    }

    private incCoarseY() {
        let y = (this.vRamAddr & 0x3E0) >> 5;
        if (y == 29) {
            //Swap nametable, vertically
            y = 0;
            this.vRamAddr ^= 0x800; //Swap NT
        } else if (y == 31) {
            y = 0;
        } else {
            y += 1;
        }
        let mask = 0xFFFF;
        mask ^= 0x3E0;
        //Put y back into vRamAddr
        this.vRamAddr = (this.vRamAddr & mask) | (y << 5);
    }

    private resetCoarseY() {
        this.vRamAddr = insertInto(this.vRamAddr, this.initRamAddr, 10, 10, 5);
    }

    private getNTAddr(): number {
        return 0x2000 | (this.vRamAddr & 0xFFF);
    }

    private getATAddr(): number {
        return 0x23C0 | (this.vRamAddr & 0x0C00) | ((this.vRamAddr >> 4) & 0x38) | ((this.vRamAddr >> 2) & 0x07);
    }

    private setVBL() {
        this.vbl = true;
        this.nes.write(this.PPUSTATUS, (this.nes.read(this.PPUSTATUS) | 0x80));
        if (this.vBlankNMI) this.nes.cpu.requestNMInterrupt();
    }

    private clearVBL() {
        this.vbl = false;
        this.nes.write(this.PPUSTATUS, (this.nes.read(this.PPUSTATUS) & 0x7F));
    }

    private clearSprite0() {
        this.nes.write(this.PPUSTATUS, (this.nes.read(this.PPUSTATUS) & 0xBF));
    }

    private clearOverflow() {
        this.nes.write(this.PPUSTATUS, (this.nes.read(this.PPUSTATUS) & 0xDF));
    }
}


//Palette Data Start
interface colorData {
    [code: string]: {
        r: number,
        g: number,
        b: number
    }
}

let colorData: colorData = {};
colorData[0x00] = {
    r: 84,
    g: 84,
    b: 84
}
colorData[0x01] = {
    r: 0,
    g: 30,
    b: 116
}
colorData[0x02] = {
    r: 8,
    g: 16,
    b: 144
}
colorData[0x03] = {
    r: 48,
    g: 0,
    b: 136
}
colorData[0x04] = {
    r: 68,
    g: 0,
    b: 100
}
colorData[0x05] = {
    r: 92,
    g: 0,
    b: 48
}
colorData[0x06] = {
    r: 84,
    g: 4,
    b: 0
}
colorData[0x07] = {
    r: 60,
    g: 24,
    b: 0
}
colorData[0x08] = {
    r: 32,
    g: 42,
    b: 0
}
colorData[0x09] = {
    r: 8,
    g: 58,
    b: 0
}
colorData[0x0A] = {
    r: 0,
    g: 64,
    b: 0
}
colorData[0x0B] = {
    r: 0,
    g: 60,
    b: 0
}
colorData[0x0C] = {
    r: 0,
    g: 50,
    b: 60
}
colorData[0x0D] = {
    r: 0,
    g: 0,
    b: 0
}
colorData[0x0E] = {
    r: 0,
    g: 0,
    b: 0
}
colorData[0x0F] = {
    r: 0,
    g: 0,
    b: 0
}
colorData[0x10] = {
    r: 152,
    g: 150,
    b: 152
}
colorData[0x11] = {
    r: 8,
    g: 76,
    b: 196
}
colorData[0x12] = {
    r: 48,
    g: 50,
    b: 236
}
colorData[0x13] = {
    r: 92,
    g: 30,
    b: 228
}
colorData[0x14] = {
    r: 136,
    g: 20,
    b: 176
}
colorData[0x15] = {
    r: 160,
    g: 20,
    b: 100
}
colorData[0x16] = {
    r: 152,
    g: 34,
    b: 32
}
colorData[0x17] = {
    r: 120,
    g: 60,
    b: 0
}
colorData[0x18] = {
    r: 84,
    g: 90,
    b: 0
}
colorData[0x19] = {
    r: 40,
    g: 114,
    b: 0
}
colorData[0x1A] = {
    r: 8,
    g: 124,
    b: 0
}
colorData[0x1B] = {
    r: 0,
    g: 118,
    b: 40
}
colorData[0x1C] = {
    r: 0,
    g: 102,
    b: 120
}
colorData[0x1D] = {
    r: 0,
    g: 0,
    b: 0
}
colorData[0x1E] = {
    r: 0,
    g: 0,
    b: 0
}
colorData[0x1F] = {
    r: 0,
    g: 0,
    b: 0
}
colorData[0x20] = {
    r: 236,
    g: 238,
    b: 236
}
colorData[0x21] = {
    r: 76,
    g: 154,
    b: 236
}
colorData[0x22] = {
    r: 120,
    g: 124,
    b: 236
}
colorData[0x23] = {
    r: 176,
    g: 98,
    b: 236
}
colorData[0x24] = {
    r: 228,
    g: 84,
    b: 236
}
colorData[0x25] = {
    r: 236,
    g: 88,
    b: 180
}
colorData[0x26] = {
    r: 236,
    g: 106,
    b: 100
}
colorData[0x27] = {
    r: 212,
    g: 136,
    b: 32
}
colorData[0x28] = {
    r: 160,
    g: 170,
    b: 0
}
colorData[0x29] = {
    r: 116,
    g: 196,
    b: 0
}
colorData[0x2A] = {
    r: 76,
    g: 208,
    b: 32
}
colorData[0x2B] = {
    r: 56,
    g: 204,
    b: 108
}
colorData[0x2C] = {
    r: 56,
    g: 180,
    b: 204
}
colorData[0x2D] = {
    r: 60,
    g: 60,
    b: 60
}
colorData[0x2E] = {
    r: 0,
    g: 0,
    b: 0
}
colorData[0x2F] = {
    r: 0,
    g: 0,
    b: 0
}
colorData[0x30] = {
    r: 236,
    g: 238,
    b: 236
}
colorData[0x31] = {
    r: 168,
    g: 204,
    b: 236
}
colorData[0x32] = {
    r: 188,
    g: 188,
    b: 236
}
colorData[0x33] = {
    r: 212,
    g: 178,
    b: 236
}
colorData[0x34] = {
    r: 236,
    g: 174,
    b: 236
}
colorData[0x35] = {
    r: 236,
    g: 174,
    b: 212
}
colorData[0x36] = {
    r: 236,
    g: 180,
    b: 176
}
colorData[0x37] = {
    r: 228,
    g: 196,
    b: 144
}
colorData[0x38] = {
    r: 204,
    g: 210,
    b: 120
}
colorData[0x39] = {
    r: 180,
    g: 222,
    b: 120
}
colorData[0x3A] = {
    r: 168,
    g: 226,
    b: 144
}
colorData[0x3B] = {
    r: 152,
    g: 226,
    b: 180
}
colorData[0x3C] = {
    r: 160,
    g: 214,
    b: 228
}
colorData[0x3D] = {
    r: 160,
    g: 162,
    b: 160
}
colorData[0x3E] = {
    r: 0,
    g: 0,
    b: 0
}
colorData[0x3F] = {
    r: 0,
    g: 0,
    b: 0
}
