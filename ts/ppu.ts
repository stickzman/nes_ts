class PPU {
    public mem: Uint8Array;
    private OAM: Uint8Array;

    private oddFrame: boolean = false;
    private latch = false;
    private vRamAddr: number;
    private scanline: number = 0;
    private dot: number = 0;

    public ctx = {
        ctx: null,
        imageData: null,
        x: 0,
        y: 0,
        setPixel: function (r: number, g: number, b: number, a: number = 255) {
            let i = this.y * this.imageData.width * 4 + this.x * 4;
            this.imageData.data[i++] = r;
            this.imageData.data[i++] = g;
            this.imageData.data[i++] = b;
            this.imageData.data[i] = a;
            if (++this.x > this.imageData.width - 1) {
                this.x = 0;
                if (++this.y > this.imageData.height - 1) {
                    this.y = 0;
                }
            }
        },
        paintFrame: function () {
            this.ctx.putImageData(this.imageData, 0, 0);
        }
    }

    private attrByte: number;
    private bkgAddr: number;
    private bkgHiByte: number;
    private bkgLoByte: number;

    //CTRL vars
    private static baseNTAddr: number = 0x2000;
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

    //Render vars
    private ntPointer = {
        row: 0, //0-29 (30 rows, each row 8 px height)
        col: 0, //0-31 (32 cols, each column 8 px width)
        addr: function () {
            return this.row * 32 + this.col + PPU.baseNTAddr;
        },
        incCol: function() {
            if (++this.col > 31) {
                this.col = 0;
            }
        },
        incRow: function() {
            if (++this.row > 29) {
                this.row = 0;
            }
        }
    }
    private atPointer = {
        row: 0, //0-7.5 (8 rows, each row 32 px height)
        col: 0, //0-8 (8 cols, each column 32 px width)
        addr: function () {
            return this.row * 8 + 0x3C0 + this.col + PPU.baseNTAddr;
        },
        incCol: function() {
            if (++this.col > 7) {
                this.col = 0;
            }
        },
        incRow: function() {
            if (++this.row > 7) {
                this.row = 0;
            }
        }
    }


    constructor(private nes: NES, private canvas: HTMLCanvasElement) {
        this.mem = new Uint8Array(0x4000);
        this.OAM = new Uint8Array(0x100);
        let ctx = canvas.getContext("2d");
        ctx.imageSmoothingEnabled = false;
        ctx.mozImageSmoothingEnabled = false;
        ctx.webkitImageSmoothingEnabled = false;
        let imgData = ctx.createImageData(canvas.width, canvas.height);
        this.ctx.ctx = ctx;
        this.ctx.imageData = imgData;
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
                if (this.oddFrame && this.dot == 0 && this.scanline == 0) this.dot++;
                this.visibleCycle();
                break;
            case (this.scanline < 260):
                if (this.scanline == 241 && this.dot == 1) this.setVBL();
                //POST-RENDER
                break;
            case (this.scanline == 261):
                if (this.dot == 1) {
                    this.clearVBL();
                    this.clearSprite0();
                    this.clearOverflow();
                }
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
        //Reset pointers
        if (this.dot == 0 && this.scanline == 261) {
            this.atPointer.row = 0;
            this.atPointer.col = 0;
            this.ntPointer.row = 0;
            this.ntPointer.col = 0;
        }
    }

    public visibleCycle() {
        if (this.dot == 0) return; //Idle on Cycle 0
        switch (true) {
            case (this.dot <= 256):
                switch (this.dot % 8) {
                    case 1:
                        //Get nameTable addr (handled below switch/case)
                        break;
                    case 2:
                        //Get nameTable byte
                        break;
                    case 3:
                        //Get attrTable addr (handled below switch/case)
                        break;
                    case 4:
                        //Get attrTable byte
                        this.attrByte = this.mem[this.atPointer.addr()];
                        break;
                    case 5:
                        //Get Low BG addr
                        this.bkgAddr = this.mem[this.ntPointer.addr()] << 4;
                        break;
                    case 6:
                        //Get Low BG byte
                        this.bkgLoByte = this.mem[this.bkgAddr + this.scanline % 8 + this.bkgPatAddr];
                        break;
                    case 7:
                        //Get High BG addr
                        this.bkgAddr += 8;
                        break;
                    case 0:
                        //Get High BG byte
                        this.bkgHiByte = this.mem[this.bkgAddr + this.scanline % 8 + this.bkgPatAddr];
                        this.render();
                        break;
                }
                break;
            case (this.dot <= 320):
                //TODO: Sprite Evaluation
                break;
        }

        if (this.dot <= 256) {
            //Inc Nametable Pointer
            if (this.dot % 8 == 0) {
                this.ntPointer.incCol();
            }
            //Inc Attr Table Pointer
            if (this.dot % 32 == 0 && this.dot != 0) {
                this.atPointer.incCol();
            }
        }
        if (this.dot == 256) {
            if (this.scanline % 32 == 31) {
                this.atPointer.incRow();
            }
            if (this.scanline % 8 == 7) {
                this.ntPointer.incRow();
            }
            if (this.scanline == 239) {
                //this.ctx.paintFrame();
                NES.drawFrame = true;
            }
        }
    }

    public render() {
        if (!this.showBkg) {
            //Get Universal Background Color and paint a blank pixel
            let palData = this.mem[0x3F00] & 0x3F;
            let col = colorData[palData];
            for (let i = 0; i < 8; i++) {
                this.ctx.setPixel(col.r, col.g, col.b);
            }
            return;
        }
        //Combine PATTERN DATA
        let pByte = [];
        let mask: number;
        for (let i = 0; i < 8; i++) {
            mask = 1 << (7 - i);
            if (i > 6) {
                pByte[i] = ((this.bkgHiByte & mask) << 1) +
                                (this.bkgLoByte & mask);
            } else {
                pByte[i] = ((this.bkgHiByte & mask) >> (6 - i)) +
                                ((this.bkgLoByte & mask) >> (7 - i));
            }
        }
        //Get PALETTE NUMBER
        let quad: number;
        if (this.dot % 32 < 16) {
            quad = (this.scanline % 32 < 16) ? 0 : 1;
        } else {
            quad = (this.scanline % 32 < 16) ? 2 : 3;
        }
        let palNum: number;
        mask = 3 << (quad * 2);
        palNum = (this.attrByte & mask) >> (quad * 2);
        for (let i = 0; i < 8; i++) {
            let palInd = 0x3F00 + palNum * 4 + pByte[i];
            let palData = this.mem[palInd] & 0x3F;
            let col = colorData[palData];
            this.ctx.setPixel(col.r, col.g, col.b);
        }
    }

    public readReg(addr: number) {
        switch (addr) {
            case this.PPUSTATUS:
                this.latch = false;
                break;
        }
    }

    public writeReg(addr: number) {
        let byte = this.nes.read(addr);
        switch (addr) {
            case this.PPUCTRL:
                let ntBit = byte & 3;
                switch (ntBit) {
                    case 0: PPU.baseNTAddr = 0x2000; break;
                    case 1: PPU.baseNTAddr = 0x2400; break;
                    case 2: PPU.baseNTAddr = 0x2800; break;
                    case 3: PPU.baseNTAddr = 0x2C00; break;
                }
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
