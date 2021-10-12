class PPU {
    public mem: Uint8Array;
    public oam: Uint8Array;
    private oamBuff: oamEntry[] = [];
    private sprite0Active: boolean = false;
    private oamAddr: number;

    public mirrorVertical: boolean;
    public singleScreenMirror: boolean = false;

    private internalReadBuff: number = 0;

    private oddFrame: boolean = false;
    private writeLatch = false;
    private vRamAddr: number = 0;
    private initRamAddr: number = 0;
    private fineX: number = 0;
    private scanline: number = 261;
    private dot: number = 0;

    //Shift registers
    private bkgQ = [];
    private attrQ = [];
    private addrQ = [];

    //CTRL vars
    private incAddrBy32: boolean = false; //If false, inc by 1
    private spritePatAddr: number = 0;
    private bkgPatAddr: number = 0;
    private sprite8x16: boolean = false; //If false, sprite size is 8x8
    private vBlankNMI: boolean = false;
    //MASK vars
    private greyscale: boolean = false;
    public static forceGreyscale: boolean = false;
    private showLeftBkg: boolean = false;
    private showLeftSprite: boolean = false;
    public showBkg: boolean = false;
    public showSprites: boolean = false;
    private maxRed: boolean = false;
    private maxGreen: boolean = false;
    private maxBlue: boolean = false;

    private readonly PPUCTRL: number = 0x2000;
    private readonly PPUMASK: number = 0x2001;
    private readonly PPUSTATUS: number = 0x2002;
    private readonly OAMADDR: number = 0x2003;
    private readonly OAMDATA: number = 0x2004;
    private readonly PPUSCROLL: number = 0x2005;
    private readonly PPUADDR: number = 0x2006;
    private readonly PPUDATA: number = 0x2007;
    private readonly OAMDMA: number = 0x4014;

    private static ctx = null;
    private static imageData = null;
    private static imageWidth: number;
    private static pixBuff8: Uint8Array = null;
    private static pixBuff32: Uint32Array = null;
    public static isLittleEndian: boolean;
    public static scale: number = 2;
    public static canvas: HTMLCanvasElement;

    constructor(private nes: NES) {
        this.mem = new Uint8Array(0x4000);
        this.oam = new Uint8Array(0x100);
        PPU.updateScale(PPU.scale);
    }

    public static updateScale(scale: number) {
        if (scale < 1 || scale % 1 != 0) {
            console.log("Display scale must a positive integer");
            return;
        }
        PPU.scale = scale;
        PPU.canvas.width = 256 * scale;
        PPU.canvas.height = 240 * scale;
        let ctx = PPU.canvas.getContext("2d", { alpha: false });
        ctx.imageSmoothingEnabled = false;
        let imgData = ctx.createImageData(PPU.canvas.width, PPU.canvas.height);
        PPU.ctx = ctx;
        PPU.imageData = imgData;
        PPU.imageWidth = imgData.width;
        //Create a buffer with 8 & 32-bit views to store pixel data b4 render
        let buff = new ArrayBuffer(imgData.data.length);
        PPU.pixBuff8 = new Uint8Array(buff);
        PPU.pixBuff32 = new Uint32Array(buff);
    }

    private setPixel (r: number, g: number, b: number) {
        if (this.nes.skipFrame) return;
        if (this.maxGreen || this.maxBlue) {
            r -= 25;
        }
        if (this.maxRed || this.maxBlue) {
            g -= 25;
        }
        if (this.maxRed || this.maxGreen) {
            b -= 25;
        }
        let i = (this.scanline * PPU.imageWidth + this.dot) * PPU.scale;
        let pixVal = (PPU.isLittleEndian) ?
            0xFF000000 | (b << 16) | (g << 8) | r :
            (r << 24) | (g << 16) | (b << 8) | 0xFF;
        for (let x = 0; x < PPU.scale; x++){
            for (let y = 0; y < PPU.scale; y++) {
                PPU.pixBuff32[i + x + (y * PPU.imageWidth)] = pixVal;
            }
        }
    }

    public paintFrame () {
        if (this.nes.skipFrame) return;
        PPU.imageData.data.set(PPU.pixBuff8);
        PPU.ctx.putImageData(PPU.imageData, 0, 0);
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

    public getState(): object {
        let obj = {};
        let ignoreList = ["nes", "PPUCTRL", "PPUMASK", "PPUSTATUS", "OAMADDR",
                        "OAMDATA", "PPUSCROLL", "PPUADDR", "PPUDATA", "OAMDMA"];
        let keys = Object.keys(this);
        for (let i = 0; i < keys.length; i++) {
            if (ignoreList.includes(keys[i])) continue;
            if (keys[i] == "mem" || keys[i] == "oam") {
                obj[keys[i]] = this[keys[i]].toString();
            } else {
                obj[keys[i]] = this[keys[i]];
            }
        }
        return obj;
    }

    public loadState(state: object) {
        let keys = Object.keys(state);
        for (let i = 0; i < keys.length; i++) {
            if (keys[i] == "mem") {
                //Parse memory str
                let arr = state[keys[i]].split(",");
                let buff = new Uint8Array(this.mem.length);
                for (let i = 0; i < buff.length; i++) {
                    buff[i] = parseInt(arr[i]);
                }
                this.mem.set(buff);
            } else if (keys[i] == "oam") {
                //Parse oam str
                let arr = state[keys[i]].split(",");
                let buff = new Uint8Array(this.oam.length);
                for (let i = 0; i < buff.length; i++) {
                    buff[i] = parseInt(arr[i]);
                }
                this.oam.set(buff);
            } else {
                this[keys[i]] = state[keys[i]];
            }
        }
    }

    public cycle() {
        if (this.oddFrame && this.scanline == 0 && this.dot == 0) {
            this.dot++;
        }
        switch (true) {
            case (this.scanline < 240):
                this.visibleCycle();
                break;
            case (this.scanline == 241):
                if (this.dot == 1) this.setVBL();
                //POST-RENDER
                break;
            case (this.scanline == 261):
                //PRE-RENDER
                if (this.dot == 1) {
                    this.clearVBL();
                    this.clearSprite0();
                    this.clearOverflow();
                } else if (this.dot == 328) {
                    this.addrQ[0] = this.vRamAddr;
                    //Get attrTable byte
                    this.attrQ[0] = this.mem[this.getATAddr()];
                    let addr = this.mem[this.getNTAddr()] << 4;

                    let fineY = (this.vRamAddr & 0x7000) >> 12;
                    //Get Low BG byte
                    let lo = this.mem[addr + fineY + this.bkgPatAddr];
                    //Get High BG byte
                    let hi = this.mem[addr + 8 + fineY + this.bkgPatAddr];

                    this.bkgQ[0] = this.combinePatData(hi, lo);

                    if (this.showBkg || this.showSprites) this.incCoarseX();
                } else if (this.dot == 336) {
                    this.addrQ[1] = this.vRamAddr;
                    //Get attrTable byte
                    this.attrQ[1] = this.mem[this.getATAddr()];
                    let addr = this.mem[this.getNTAddr()] << 4;

                    let fineY = (this.vRamAddr & 0x7000) >> 12;
                    //Get Low BG byte
                    let lo = this.mem[addr + fineY + this.bkgPatAddr];
                    //Get High BG byte
                    let hi = this.mem[addr + 8 + fineY + this.bkgPatAddr];
                    this.bkgQ[1] = this.combinePatData(hi, lo);

                    if (this.showBkg || this.showSprites) this.incCoarseX();
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
            if (this.showBkg || this.showSprites) this.vRamAddr = this.initRamAddr;
        }

        if (this.scanline == 239 && this.dot == 256) {
            this.nes.drawFrame = true;
        }
    }

    public visibleCycle() {
        if (this.nes.skipFrame) {
            if (this.scanline == 0 && this.dot === 257) {
                // Set Sprite 0 flag to avoid slowdown on discarded frames
                this.setSprite0();
            }
            return
        }

        if (!this.showBkg && !this.showSprites) {
            if (this.dot < 256) {
                this.render();
            }
            return;
        }
        if (this.dot <= 256) {
            if (this.dot % 8 == 0 && this.dot != 0) {
                this.addrQ[1] = this.vRamAddr;
                //Get attrTable byte
                this.attrQ[1] = this.mem[this.getATAddr()];
                let addr = this.mem[this.getNTAddr()] << 4;

                let fineY = (this.vRamAddr & 0x7000) >> 12;
                //Get Low BG byte
                let lo = this.mem[addr + fineY + this.bkgPatAddr];
                //Get High BG byte
                let hi = this.mem[addr + 8 + fineY + this.bkgPatAddr];

                this.bkgQ[1] = this.combinePatData(hi, lo);

                //Inc NT Pointer
                if (this.dot < 256) {
                    this.incCoarseX();
                } else {
                    this.resetCoarseX();
                    this.incY();
                    if (this.scanline == 239) {
                        this.resetCoarseY();
                    }
                }
            }
            if (this.dot < 256) {
                this.render();
            }
        } else if (this.dot == 257) {
            //Sprite evaulation for next scanline
            this.sprite0Active = false;
            this.oamBuff = [];
            for (let i = 0; i < this.oam.length; i += 4) {
                //If sprite is visible on scanline, add it to 2nd OAM
                if (this.oam[i] <= this.scanline) {
                    if (this.oam[i] > this.scanline - 8 || (this.oam[i] > this.scanline - 16 && this.sprite8x16)) {
                        let entry: oamEntry = {
                            x: 0,
                            patData: [],
                            paletteNum: 0,
                            priority: false,
                            isSprite0: false
                        };
                        if (i == 0) {
                            entry.isSprite0 = true;
                            this.sprite0Active = true;
                        }
                        entry.x = this.oam[i+3];
                        entry.paletteNum = (this.oam[i+2] & 3) + 4;
                        entry.priority = (this.oam[i+2] & 0x20) == 0;
                        let offSet = this.scanline - this.oam[i];
                        //Flip vertically
                        if ((this.oam[i+2] & 0x80) != 0) {
                            if (this.sprite8x16) {
                                offSet = 15 - offSet;
                            } else {
                                offSet = 7 - offSet;
                            }
                        }
                        let addr: number;
                        let lo: number;
                        let hi: number;
                        if (this.sprite8x16) {
                            addr = this.oam[i+1] >> 1;
                            if (offSet > 7) offSet += 8;
                            addr = addr << 5;
                            addr += ((this.oam[i+1] & 1) == 0) ? 0 : 0x1000;
                            lo = this.mem[addr + offSet];
                            hi = this.mem[addr + offSet + 8];
                        } else {
                            addr = this.oam[i+1] << 4;
                            lo = this.mem[addr + offSet + this.spritePatAddr];
                            hi = this.mem[addr + offSet + this.spritePatAddr + 8];
                        }
                        entry.patData = this.combinePatData(hi, lo);
                        //Flip horizontally
                        if (this.oam[i+2] & 0x40) entry.patData = entry.patData.reverse();
                        this.oamBuff.push(entry);
                        if (this.oamBuff.length == 8) break;
                    }
                }
            }
        } else if (this.dot == 328) {
            this.addrQ[0] = this.vRamAddr;
            //Get attrTable byte
            this.attrQ[0] = this.mem[this.getATAddr()];
            let addr = this.mem[this.getNTAddr()] << 4;

            let fineY = (this.vRamAddr & 0x7000) >> 12;
            //Get Low BG byte
            let lo = this.mem[addr + fineY + this.bkgPatAddr];
            //Get High BG byte
            let hi = this.mem[addr + 8 + fineY + this.bkgPatAddr];

            this.bkgQ[0] = this.combinePatData(hi, lo);

            if (this.showBkg || this.showSprites) this.incCoarseX();
        } else if (this.dot == 336) {
            this.addrQ[1] = this.vRamAddr;
            //Get attrTable byte
            this.attrQ[1] = this.mem[this.getATAddr()];
            let addr = this.mem[this.getNTAddr()] << 4;

            let fineY = (this.vRamAddr & 0x7000) >> 12;
            //Get Low BG byte
            let lo = this.mem[addr + fineY + this.bkgPatAddr];
            //Get High BG byte
            let hi = this.mem[addr + 8 + fineY + this.bkgPatAddr];

            this.bkgQ[1] = this.combinePatData(hi, lo);
            if (this.showBkg || this.showSprites) this.incCoarseX();
        }
    }

    public render() {
        let uBkgData = this.mem[0x3F00] & 0x3F;
        if (!this.showBkg) {
            //Get Universal Background Color and paint a blank pixel
            if (PPU.forceGreyscale || this.greyscale) uBkgData &= 0x30;
            if (!this.showSprites) {
                let col = colorData[uBkgData];
                this.setPixel(col.r, col.g, col.b);
                return;
            }
        }
        let bitSelect = this.dot % 8 + this.fineX;
        if (bitSelect > 7) bitSelect -= 8;
        let palData = this.getSpritePix(this.showBkg && this.bkgQ[0][bitSelect] != 0);

        if (!this.showBkg && palData == null) {
            let col = colorData[uBkgData];
            this.setPixel(col.r, col.g, col.b);
            return;
        }

        if (palData == null || !this.showSprites) {
            //Get background pixel
            //Get PALETTE NUMBER
            if (!this.showLeftBkg && this.dot < 8 || this.bkgQ[0][bitSelect] == 0) {
                palData = uBkgData;
            } else {
                let x = (((this.addrQ[0] & 0x1F) * 8) + this.fineX);
                let y = ((this.addrQ[0] & 0x03E0) >> 5) * 8 + ((this.addrQ[0] & 0x7000) >> 12);
                let quad: number;
                if (x % 32 < 16) {
                    quad = (y % 32 < 16) ? 0 : 2;
                } else {
                    quad = (y % 32 < 16) ? 1 : 3;
                }
                let palNum: number;
                let mask = 3 << (quad * 2);
                palNum = (this.attrQ[0] & mask) >> (quad * 2);

                let palInd = 0x3F00 + palNum * 4 + this.bkgQ[0][bitSelect];
                palData = this.mem[palInd] & 0x3F;
            }
        }

        if (PPU.forceGreyscale || this.greyscale) palData &= 0x30;
        let col = colorData[palData];
        this.setPixel(col.r, col.g, col.b);

        if (bitSelect % 8 == 7) {
            this.bkgQ[0] = this.bkgQ[1];
            this.attrQ[0] = this.attrQ[1];
            this.addrQ[0] = this.addrQ[1];
        }
    }

    public getSpritePix(bkgIsVis) {
        if (!this.showSprites || (!this.showLeftSprite && this.dot < 8)) return null;
        let entry: oamEntry;
        let pix: number;
        let sprite0Pix: number;
        for (let i = 0; i < this.oamBuff.length; i++) {
            if (this.oamBuff[i].x > this.dot - 8 && this.oamBuff[i].x <= this.dot) {
                entry = this.oamBuff[i];
                pix = entry.patData[this.dot - entry.x];
                if (pix == 0) {
                    entry = undefined;
                    pix = undefined;
                    continue;
                }
                if (entry.isSprite0) sprite0Pix = pix;
                if (bkgIsVis && this.sprite0Active && sprite0Pix == undefined) {
                    //Finish searching secondary OAM for sprite0 only
                    for (i; i < this.oamBuff.length; i++){
                        if (this.oamBuff[i].x > this.dot - 8 &&
                                this.oamBuff[i].x <= this.dot &&
                                this.oamBuff[i].isSprite0) {
                            sprite0Pix = this.oamBuff[i].patData[this.dot - this.oamBuff[i].x];
                            break;
                        }
                    }
                }
                break;
            }
        }
        if (entry === undefined) return null;
        if (bkgIsVis) {
            if (sprite0Pix !== undefined && sprite0Pix != 0) this.setSprite0();
            if (!entry.priority) return null;
        }

        let palInd = 0x3F00 + entry.paletteNum * 4 + pix;
        return this.mem[palInd] & 0x3F;
    }

    public write(addr: number, data: number) {
        if (addr >= 0x3F00) {
            //Mirror Palette RAM
            if (addr % 4 == 0) {
                //Special case for background colors
                for (let i = 0x3F00; i < 0x4000; i += 0x10) {
                    this.mem[i + (addr % 0x10)] = data;
                }
            } else {
                for (let i = 0x3F00; i < 0x4000; i += 0x20) {
                    this.mem[i + (addr % 0x20)] = data;
                }
            }
        } else if (addr >= 0x2000 && addr <= 0x2EFF) {
            //Mirror Nametables
            this.mem[addr + 0x1000] = data;
        } else if (addr >= 0x3000 && addr < 0x3F00) {
            //Mirror Nametables
            this.mem[addr - 0x1000] = data;
        }
        this.mem[addr] = data;
    }

    public readReg(addr: number): number {
        switch (addr) {
            case this.PPUSTATUS:
                this.writeLatch = false;
                break;
            case this.OAMDATA:
                return this.oam[this.oamAddr];
            case this.PPUDATA:
                let res = this.internalReadBuff;
                if (this.vRamAddr >= 0x3F00) {
                    res = this.mem[this.vRamAddr];
                    this.internalReadBuff = this.mem[this.vRamAddr - 0x1000];
                } else {
                    this.internalReadBuff = this.mem[this.vRamAddr];
                }
                this.incVRAM();
                return res;
        }
        return;
    }

    public writeReg(addr: number, byte: number) {
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
                    this.initRamAddr &= 0x3FFF;
                    let oldBit = this.vRamAddr & (1 << 12);
                    this.vRamAddr = this.initRamAddr;
                    if (this.nes.rom.mapper instanceof MMC3 &&
                        oldBit != (this.vRamAddr & (1 << 12))) {
                            this.nes.rom.mapper.decIRQ();
                    }
                }
                this.writeLatch = !this.writeLatch;
                break;
            case this.PPUDATA:
                if (this.vRamAddr >= 0x2000 && this.vRamAddr <= 0x3000) {
                    if (this.singleScreenMirror) {
                        let addr = this.vRamAddr - 0x2000;
                        addr %= 0x400;
                        for (let i = 0x2000; i < 0x3000; i += 0x400) {
                            this.write(i + addr, byte);

                        }
                    } else if (this.mirrorVertical) {
                        this.write(this.vRamAddr, byte);
                        if (this.vRamAddr < 0x2800) {
                            this.write(this.vRamAddr + 0x800, byte);
                        } else {
                            this.write(this.vRamAddr - 0x800, byte);
                        }
                    } else {
                        this.write(this.vRamAddr, byte);
                        if ((this.vRamAddr - 0x2000) % 0x800 < 0x400) {
                            this.write(this.vRamAddr + 0x400, byte);
                        } else {
                            this.write(this.vRamAddr - 0x400, byte);
                        }
                    }
                } else {
                    this.write(this.vRamAddr, byte);
                }
                this.incVRAM();
                break;
            case this.OAMADDR:
                this.oamAddr = byte;
                break;
            case this.OAMDATA:
                this.oam[this.oamAddr++] = byte;
                if (this.oamAddr > 0xFF) this.oamAddr = 0;
                break;
            case this.OAMDMA:
                let slice = this.nes.mainMemory.slice((byte << 8), ((byte + 1) << 8));
                if (this.oamAddr == 0) {
                    this.oam.set(slice, 0);
                } else {
                    let first = slice.slice(0, (0x100 - this.oamAddr));
                    let second = slice.slice((0x100 - this.oamAddr), 0x100);
                    this.oam.set(first, this.oamAddr);
                    this.oam.set(second, 0);
                }
                //Catch up to the 514 CPU cycles used
                for (let i = 0; i < 514 * 3; i++) {
                    this.cycle();
                }
                break;
            case this.PPUSCROLL:
                if (!this.writeLatch) {
                    this.initRamAddr = insertInto(this.initRamAddr, byte, 5, 8, 3);
                    this.fineX = byte & 7;
                } else {
                    this.initRamAddr = insertInto(this.initRamAddr, byte, 15, 3, 0);
                    this.initRamAddr = insertInto(this.initRamAddr, byte, 10, 8, 3);
                }
                this.writeLatch = !this.writeLatch;
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
        this.vRamAddr = insertInto(this.vRamAddr, this.initRamAddr, 11, 11, 10);
    }

    private incY() {
        if ((this.vRamAddr & 0x7000) != 0x7000) {
            this.vRamAddr += 0x1000; //If fineY != 7, inc by 1
            if (this.nes.rom.mapper instanceof MMC3) this.nes.rom.mapper.decIRQ();
        } else {
            this.vRamAddr &= 0xFFF; //Reset fineY to 0
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
            if (this.nes.rom.mapper instanceof MMC3) this.nes.rom.mapper.decIRQ();
        }
    }

    private resetCoarseY() {
        let oldBit = this.vRamAddr & (1 << 12);
        this.vRamAddr = insertInto(this.vRamAddr, this.initRamAddr, 10, 10, 5);
        this.vRamAddr = insertInto(this.vRamAddr, this.initRamAddr, 15, 15, 11);
        if (this.nes.rom.mapper instanceof MMC3 &&
            oldBit != (this.vRamAddr & (1 << 12))) {
                this.nes.rom.mapper.decIRQ();
        }
    }

    private incVRAM() {
        if (this.incAddrBy32) {
            this.vRamAddr += 32;
        } else {
            this.vRamAddr++;
        }
        while (this.vRamAddr > 0x3FFF) {
            this.vRamAddr -= 0x4000;
        }
    }

    private getNTAddr(): number {
        return 0x2000 | (this.vRamAddr & 0xFFF);
    }

    private getATAddr(): number {
        return 0x23C0 | (this.vRamAddr & 0x0C00) | ((this.vRamAddr >> 4) & 0x38) | ((this.vRamAddr >> 2) & 0x07);
    }

    private setVBL() {
        this.nes.write(this.PPUSTATUS, (this.nes.readNoReg(this.PPUSTATUS) | 0x80));
        if (this.vBlankNMI) this.nes.cpu.requestNMInterrupt();
    }

    private clearVBL() {
        this.nes.write(this.PPUSTATUS, (this.nes.readNoReg(this.PPUSTATUS) & 0x7F));
    }

    private clearSprite0() {
        this.nes.write(this.PPUSTATUS, (this.nes.readNoReg(this.PPUSTATUS) & 0xBF));
    }

    private setSprite0() {
        this.nes.write(this.PPUSTATUS, (this.nes.readNoReg(this.PPUSTATUS) | 0x40));
    }

    private clearOverflow() {
        this.nes.write(this.PPUSTATUS, (this.nes.readNoReg(this.PPUSTATUS) & 0xDF));
    }
}

let colorData = [{
    "r": 102,
    "g": 102,
    "b": 102
}, {
    "r": 0,
    "g": 42,
    "b": 136
}, {
    "r": 20,
    "g": 18,
    "b": 167
}, {
    "r": 59,
    "g": 0,
    "b": 164
}, {
    "r": 92,
    "g": 0,
    "b": 126
}, {
    "r": 110,
    "g": 0,
    "b": 64
}, {
    "r": 108,
    "g": 6,
    "b": 0
}, {
    "r": 86,
    "g": 29,
    "b": 0
}, {
    "r": 51,
    "g": 53,
    "b": 0
}, {
    "r": 11,
    "g": 72,
    "b": 0
}, {
    "r": 0,
    "g": 82,
    "b": 0
}, {
    "r": 0,
    "g": 79,
    "b": 8
}, {
    "r": 0,
    "g": 64,
    "b": 77
}, {
    "r": 0,
    "g": 0,
    "b": 0
}, {
    "r": 0,
    "g": 0,
    "b": 0
}, {
    "r": 0,
    "g": 0,
    "b": 0
}, {
    "r": 173,
    "g": 173,
    "b": 173
}, {
    "r": 21,
    "g": 95,
    "b": 217
}, {
    "r": 66,
    "g": 64,
    "b": 255
}, {
    "r": 117,
    "g": 39,
    "b": 254
}, {
    "r": 160,
    "g": 26,
    "b": 204
}, {
    "r": 183,
    "g": 30,
    "b": 123
}, {
    "r": 181,
    "g": 49,
    "b": 32
}, {
    "r": 153,
    "g": 78,
    "b": 0
}, {
    "r": 107,
    "g": 109,
    "b": 0
}, {
    "r": 56,
    "g": 135,
    "b": 0
}, {
    "r": 12,
    "g": 147,
    "b": 0
}, {
    "r": 0,
    "g": 143,
    "b": 50
}, {
    "r": 0,
    "g": 124,
    "b": 141
}, {
    "r": 0,
    "g": 0,
    "b": 0
}, {
    "r": 0,
    "g": 0,
    "b": 0
}, {
    "r": 0,
    "g": 0,
    "b": 0
}, {
    "r": 255,
    "g": 254,
    "b": 255
}, {
    "r": 100,
    "g": 176,
    "b": 255
}, {
    "r": 146,
    "g": 144,
    "b": 255
}, {
    "r": 198,
    "g": 118,
    "b": 255
}, {
    "r": 243,
    "g": 106,
    "b": 255
}, {
    "r": 254,
    "g": 110,
    "b": 204
}, {
    "r": 254,
    "g": 129,
    "b": 112
}, {
    "r": 234,
    "g": 158,
    "b": 34
}, {
    "r": 188,
    "g": 190,
    "b": 0
}, {
    "r": 136,
    "g": 216,
    "b": 0
}, {
    "r": 92,
    "g": 228,
    "b": 48
}, {
    "r": 69,
    "g": 224,
    "b": 130
}, {
    "r": 72,
    "g": 205,
    "b": 222
}, {
    "r": 79,
    "g": 79,
    "b": 79
}, {
    "r": 0,
    "g": 0,
    "b": 0
}, {
    "r": 0,
    "g": 0,
    "b": 0
}, {
    "r": 255,
    "g": 254,
    "b": 255
}, {
    "r": 192,
    "g": 223,
    "b": 255
}, {
    "r": 211,
    "g": 210,
    "b": 255
}, {
    "r": 232,
    "g": 200,
    "b": 255
}, {
    "r": 251,
    "g": 194,
    "b": 255
}, {
    "r": 254,
    "g": 196,
    "b": 234
}, {
    "r": 254,
    "g": 204,
    "b": 197
}, {
    "r": 247,
    "g": 216,
    "b": 165
}, {
    "r": 228,
    "g": 229,
    "b": 148
}, {
    "r": 207,
    "g": 239,
    "b": 150
}, {
    "r": 189,
    "g": 244,
    "b": 171
}, {
    "r": 179,
    "g": 243,
    "b": 204
}, {
    "r": 181,
    "g": 235,
    "b": 242
}, {
    "r": 184,
    "g": 184,
    "b": 184
}, {
    "r": 0,
    "g": 0,
    "b": 0
}, {
    "r": 0,
    "g": 0,
    "b": 0
}];
