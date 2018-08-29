/// <reference path="helper.ts" />
/// <reference path="mapper.ts" />
class iNESFile {
    public mapper: Mapper;
    public id: string;

    public pgrPages: number; //Num of 1 x 16kB pages for PGR mem
    public chrPages: number; //Num of 1 x 8kB pages for CHR mem
    public mapNum: number; //Num of mapper used by program
    //private subMapNum: number; //Num of submapper (iNES 2.0 only)
    public fourScreenMode: boolean;
    public trainerPresent: boolean;
    public batteryBacked: boolean;
    //public mirrorVertical: boolean;
    public vsGame: boolean; //Is it a Vs. Unisystem game?
    public isPC10: boolean; //Is it a Playchoice 10 game?
    public nes2_0: boolean; //Is this an iNES 2.0 file

    //May be undefined if iNES 1.0 is loaded
    public pgrRamSize: number; //Amount of PGR RAM not battery backed
    public pgrRamBattSize: number; //Amount of battery backed PGR RAM
    public chrRamSize: number; //Amount of CHR RAM not battery backed
    public chrRamBattSize: number; //Amount of battery backed CHR RAM
    public isPAL: boolean; //Is it a PAL or NTSC game?
    public bothFormats: boolean; //Will the game adjust to both NTSC and PAL?

    constructor(buff: Uint8Array, nes: NES) {
        this.id = md5(buff.toString());
        //Check if valid iNES file (file starts with 'NES' and character break)
        if (buff[0] !== 0x4E) throw Error("Corrupted iNES file!"); //N
        if (buff[1] !== 0x45) throw Error("Corrupted iNES file!"); //E
        if (buff[2] !== 0x53) throw Error("Corrupted iNES file!"); //S
        if (buff[3] !== 0x1A) throw Error("Corrupted iNES file!"); //[END]
        this.pgrPages = buff[4]; //PGR size
        this.chrPages = buff[5]; //CHR size

        //Split byte 6 into mapper # and settings byte
        let byte: number = buff[6];
        let mask: number = 0xF << 4;
        this.mapNum = (byte & mask) >> 4;
        //Parse settings
        mask = 1;
        nes.ppu.mirrorVertical = (byte & mask) != 0;
        mask = 1 << 1;
        this.batteryBacked = (byte & mask) != 0;
        mask = 1 << 2;
        this.trainerPresent = (byte & mask) != 0;
        mask = 1 << 3;
        this.fourScreenMode = (byte & mask) != 0;

        //Byte 7
        byte = buff[7];
        //Check if this is an iNes 2.0 header
        mask = 3 << 2;
        this.nes2_0 = ((byte & mask) >> 2) == 2;

        if (this.nes2_0) {
            mask = 0xF << 4;
            //Get the hiByte of the mapper #
            this.mapNum = this.mapNum | (byte & mask);
            //Get additional settings
            mask = 1;
            this.vsGame = (byte & mask) != 0;
            mask = 1 << 1;
            this.isPC10 = (byte & mask) != 0;
            //TODO: Parse byte 8
            //Byte 9
            byte = buff[9];
            mask = 0xF;
            this.pgrPages = ((byte & mask) << 4) | this.pgrPages;
            mask <<= 4;
            this.chrPages = (byte & mask) | this.chrPages;
            //Byte 10
            byte = buff[10];
            mask = 0xF;
            this.pgrRamSize = byte & mask;
            mask <<= 4;
            this.pgrRamBattSize = (byte & mask) >> 4;
            //Byte 11
            byte = buff[11];
            mask = 0xF;
            this.chrRamSize = byte & mask;
            mask <<= 4;
            this.chrRamBattSize = (byte & mask) >> 4;
            //Byte 12
            byte = buff[12];
            mask = 1;
            this.isPAL = (byte & mask) != 0;
            mask = 1 << 1;
            this.bothFormats = (byte & mask) != 0;
            //TODO: Byte 13 (Vs. Hardware)
            //TODO: Byte 14 (Misc. ROMs)
        }

        //Initiate Mapper
        switch(this.mapNum) {
            case 0:
                if (this.chrPages > 1) {
                    this.mapper = new CNROM(nes, buff, this, nes.mainMemory, nes.ppu.mem);
                } else if (this.pgrPages > 2) {
                    this.mapper = new UNROM(nes, buff, this, nes.mainMemory, nes.ppu.mem);
                } else {
                    this.mapper = new NROM(nes, buff, this, nes.mainMemory, nes.ppu.mem);
                }
                break;
            case 1: this.mapper = new MMC1(nes, buff, this, nes.mainMemory, nes.ppu.mem); break;
            case 2: this.mapper = new UNROM(nes, buff, this, nes.mainMemory, nes.ppu.mem); break;
            case 3: this.mapper = new CNROM(nes, buff, this, nes.mainMemory, nes.ppu.mem); break;
            default: //Unsupported Mapper
                alert("Warning: Unsupported Mapper\nThis game is not yet supported.");
        }
    }
}
