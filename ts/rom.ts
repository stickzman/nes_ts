class iNESFile {
    public pgrRom : Uint8Array;
    public chrRom: Uint8Array;
    public trainerData: Uint8Array;

    public fileName: string;

    private pgrPages: number; //Num of 1 x 16kB pages for PGR mem
    private chrPages: number; //Num of 1 x 8kB pages for CHR mem
    public mapNum: number; //Num of mapper used by program
    //private subMapNum: number; //Num of submapper (iNES 2.0 only)
    private fourScreenMode: boolean;
    private trainerPresent: boolean;
    private batteryBacked: boolean;
    public mirrorVertical: boolean;
    private vsGame: boolean; //Is it a Vs. Unisystem game?
    private isPC10: boolean; //Is it a Playchoice 10 game?
    private nes2_0: boolean; //Is this an iNES 2.0 file

    //May be undefined if iNES 1.0 is loaded
    private pgrRamSize: number; //Amount of PGR RAM not battery backed
    private pgrRamBattSize: number; //Amount of battery backed PGR RAM
    private chrRamSize: number; //Amount of CHR RAM not battery backed
    private chrRamBattSize: number; //Amount of battery backed CHR RAM
    private isPAL: boolean; //Is it a PAL or NTSC game?
    private bothFormats: boolean; //Will the game adjust to both NTSC and PAL?

    constructor(buff: Uint8Array) {
        //Check if valid iNES file (file starts with 'NES' and character break)
        if (buff[0] !== 0x4E) throw Error("Corrupted iNES file!"); //N
        if (buff[1] !== 0x45) throw Error("Corrupted iNES file!"); //E
        if (buff[2] !== 0x53) throw Error("Corrupted iNES file!"); //S
        if (buff[3] !== 0x1A) throw Error("Corrupted iNES file!"); //[END]
        this.pgrPages = buff[4]; //PGR size
        this.chrPages = buff[5]; //CHR size

        //Split byte 6 into mapper # and settings byte
        let hexStr = buff[6].toString(16);
        this.mapNum = parseInt(hexStr[0], 16);
        //Parse settings
        let lowNib = parseInt(hexStr[1], 16);
        let mask = 1;
        this.mirrorVertical = (lowNib & mask) != 0;
        mask = 1 << 1;
        this.batteryBacked = (lowNib & mask) != 0;
        mask = 1 << 2;
        this.trainerPresent = (lowNib & mask) != 0;
        mask = 1 << 3;
        this.fourScreenMode = (lowNib & mask) != 0;

        //Byte 7
        hexStr = buff[7].toString(16);
        //Get the hiByte of the mapper #
        let hiNib = parseInt(hexStr[0], 16);
        hiNib = hiNib << 4;
        this.mapNum = this.mapNum | hiNib;
        //Get additional settings
        lowNib = parseInt(hexStr[1], 16);
        mask = 1;
        this.vsGame = (lowNib & mask) != 0;
        mask = 1 << 1;
        this.isPC10 = (lowNib & mask) != 0;
        mask = 3 << 2;
        this.nes2_0 = (lowNib & mask) == 2;

        if (this.nes2_0) {
            //TODO: Parse byte 8
            //Byte 9
            hexStr = buff[9].toString(16);
            hiNib = parseInt(hexStr[0], 16);
            lowNib = parseInt(hexStr[1], 16);
            this.chrPages = ((hiNib << 4) & this.chrPages);
            this.pgrPages = ((lowNib << 4) & this.pgrPages);
            //Byte 10
            hexStr = buff[10].toString(16);
            hiNib = parseInt(hexStr[0], 16);
            lowNib = parseInt(hexStr[1], 16);
            this.pgrRamBattSize = hiNib;
            this.pgrRamSize = lowNib;
            //Byte 11
            hexStr = buff[11].toString(16);
            hiNib = parseInt(hexStr[0], 16);
            lowNib = parseInt(hexStr[1], 16);
            this.chrRamBattSize = hiNib;
            this.chrRamSize = lowNib;
            //Byte 12
            hexStr = buff[12].toString(16);
            let byte = parseInt(hexStr, 16);
            mask = 1;
            this.isPAL = (byte & mask) != 0;
            mask = 1 << 1;
            this.bothFormats = (byte & mask) != 0;
            //TODO: Byte 13 (Vs. Hardware)
            //TODO: Byte 14 (Misc. ROMs)
        }

        //Start loading memory
        let startLoc = 0x10;
        if (this.trainerPresent) {
            this.trainerData = new Uint8Array(
                buff.slice(startLoc, startLoc + 0x200));
            startLoc += 0x200;
        }
        this.pgrRom = new Uint8Array(
            buff.slice(startLoc, startLoc + 0x4000 * this.pgrPages));
        startLoc += 0x4000 * this.pgrPages;
        this.chrRom = new Uint8Array(
            buff.slice(startLoc, startLoc + 0x2000 * this.chrPages));
        startLoc += 0x2000 * this.chrPages;
    }

    public load(mem: Uint8Array, ppuMem: Uint8Array) {
        switch(this.mapNum) {
            case 0: //NROM
                mem.set(this.pgrRom, 0x8000);
                mem.set(this.pgrRom, 0xC000);
                ppuMem.set(this.chrRom, 0)
                break;
            default: //Unsupported Mapper
                alert("Warning: Unsupported Mapper\nThis game is not yet supported. "
                    + "It may not run correctly and will likely crash upon start");
        }
    }
}
