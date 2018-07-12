/// <reference path="opCodes.ts" />
class p6502 {
    public static debug: boolean = false; //Output debug info
    //Stop execution when an infinite loop is detected
    public static detectTraps: boolean = false;

    private static readonly CPU_SPEED: number = -1; //in MHz, -1 for unlimited
    private static readonly MEM_PATH = "mem.hex";
    private static readonly MEM_SIZE = 0x10000;
    private static readonly RES_VECT_LOC = 0xFFFC;
    private static readonly INT_VECT_LOC = 0xFFFE;
    private static readonly NMI_VECT_LOC = 0xFFFA;

    private static mem: Uint8Array;
    private static fs = require("fs");

    private static IRQ: boolean = false; //Interrupt Request signal line
    private static NMI: boolean = false; //Non-Maskable Interrupt signal line

    private static ACC: number = 0;//Accumulator
    private static X: number = 0;  //Register X
    private static Y: number = 0;  //Register Y
    private static PC: number = 0; //Program Counter
    private static SP: number = 0xFF; //Stack Pointer
    private static flags = {
        carry: false, //Last op caused overflow from bit 7 (or 0) of result
        zero: false, //Result of last op was 0
        interruptDisable: false, //Processor will ignore interrupts when true
        decimalMode: false, //Enables BCD arithmetic (ignored in NES)
        break: false, //Set when BRK op was executed
        overflow: false, //Arithmetic yielded invalid 2's complement result
        negative: false //Result of last op had bit 7 set to 1
    }

    public static boot() {
        if (this.mem === undefined) {
            //Load existing memory, otherwise create empty [filled with 0xFF]
            //buffer and write it to file.
            if (this.fs.existsSync("mem.hex")) {
                this.loadMemory("mem.hex");
            } else {
                this.mem = new Uint8Array(0x10000);
                this.mem.fill(0xFF);
            }
        }
        this.reset();

        let maxMSCycleCount = this.CPU_SPEED*1000;
        let currMSCycleCount = 0;
        let prevMS = Date.now();

        //Main loop
        while(!this.flags.break) {
            if (this.CPU_SPEED != -1 && currMSCycleCount >= maxMSCycleCount) {
                while (prevMS == Date.now()) {
                    //Sit and wait
                }
                prevMS = Date.now();
                currMSCycleCount = 0;
            }

            //Check interrupt lines
            if (this.NMI) {
                this.NMI = false;
                this.handleInterrupt(this.NMI_VECT_LOC);
            } else if (this.IRQ && !this.flags.interruptDisable) {
                this.IRQ = false;
                this.handleInterrupt(this.INT_VECT_LOC);
            }

            let opCode = this.mem[this.PC]; //Fetch

            let op = opTable[opCode];       //Decode
            if (op === undefined) {
                console.log(`ERROR: Encountered unknown opCode: [0x${
                    opCode.toString(16).toUpperCase()}] at PC: 0x${
                    this.PC.toString(16).padStart(4, "0").toUpperCase()}`);
                break;
            }

            if (this.debug) {
                console.log(`Executing ${op.name} at 0x${
                    this.PC.toString(16).padStart(4, "0").toUpperCase()}...`);
            }

            op.execute.bind(this)();        //Execute

            if (this.debug) {
                p6502.displayState();
                console.log("");
            }

            this.PC += op.bytes;
            currMSCycleCount += op.cycles;
        }

        //Write memory to file
        this.writeMem();
    }

    public static loadMemory(filePath: string) {
        this.mem = this.fs.readFileSync(filePath);
    }

    public static loadProg(filePath: string) {
        let prog = this.fs.readFileSync(filePath) as Buffer;
        this.loadProgBuff(prog);
    }

    public static loadProgStr(str: string) {
        str = str.replace(/[^A-z0-9]/g, "");
        let prog = Buffer.from(str, "hex");
        this.loadProgBuff(prog);
    }

    private static loadProgBuff(buff: Buffer) {
        let mem = new Buffer(this.MEM_SIZE);
        mem.fill(0xFF);
        buff.copy(mem, 0x0200);
        mem[this.RES_VECT_LOC] = 0x00;
        mem[this.RES_VECT_LOC + 1] = 0x02;
        this.mem = mem as Uint8Array;
    }

    private static writeMem() {
        let fs = require("fs");
        fs.writeFileSync(this.MEM_PATH, Buffer.from(this.mem));
    }

    public static requestInterrupt() {
        this.IRQ = true;
    }

    public static requestNMInterrupt() {
        this.NMI = true;
    }

    public static reset() {
        this.flags.interruptDisable = true;
        //this.PC = this.getResetVector();
        this.PC = 0x400;
        this.flags.interruptDisable = false;
    }

    private static handleInterrupt(resetVectStartAddr: number, setBRK = false) {
        //Split PC and add each addr byte to stack
        let bytes = splitHex(this.PC);
        this.pushStack(bytes[0]); //MSB
        this.pushStack(bytes[1]); //LSB
        //Store the processor status in the stack
        let statusByte = 0x00;
        //Set each bit accoriding to flags, ignoring the break flag
        statusByte += (this.flags.carry) ? 1 : 0;
        statusByte += (this.flags.zero) ? 2 : 0;
        statusByte += (this.flags.interruptDisable) ? 4 : 0;
        statusByte += (this.flags.decimalMode) ? 8 : 0;
        statusByte += (setBRK) ? 16 : 0;
        statusByte += 32; //This bit always set
        statusByte += (this.flags.overflow) ? 64 : 0;
        statusByte += (this.flags.negative) ? 128 : 0;
        this.pushStack(statusByte);

        this.flags.interruptDisable = true;
        //Set program counter to interrupt vector
        let vector = new Uint8Array(
            this.mem.slice(resetVectStartAddr, resetVectStartAddr+2));
        this.PC = combineHexBuff(vector.reverse());
    }

    private static getResetVector(): number{
        let bytes = new Uint8Array(this.mem.slice(0xFFFC,0xFFFE));
        return combineHexBuff(bytes.reverse());
    }

    private static pushStack(byte: number) {
        //Write byte to stack
        this.mem[combineHex(0x01, this.SP)] = byte;
        //Decrement stack pointer, wrap if necessary
        this.SP--;
        if (this.SP < 0) { this.SP = 0xFF; }
    }

    private static pullStack(): number {
        this.SP++;
        if (this.SP > 0xFF) { this.SP = 0; }
        let byte = this.mem[combineHex(0x01, this.SP)];
        return byte;
    }

    public static displayState() {
        //Print Registers
        console.log(`[ACC: 0x${
            this.ACC.toString(16).padStart(2, "0").toUpperCase()
            } X: 0x${this.X.toString(16).padStart(2, "0").toUpperCase()
            } Y: 0x${this.Y.toString(16).padStart(2, "0").toUpperCase()
            } PC: 0x${this.PC.toString(16).padStart(4, "0").toUpperCase()
            } SP: 0x${this.SP.toString(16).padStart(2, "0").toUpperCase()} ]`);

        //Print flags
        let keys = Object.getOwnPropertyNames(this.flags);
        for (let key of keys) {
            console.log(`${key}: ${this.flags[key]}`);
        }
    }

    private static nextByte(): number {
        return this.mem[this.PC+1];
    }

    private static next2Bytes(flip = true): number {
        let bytes = new Uint8Array(this.mem.slice(this.PC+1, this.PC+3));
        if (flip) {
            bytes.reverse();
        }
        return combineHexBuff(bytes);
    }

    private static updateOverflowFlag(reg: number, num1: number, num2: number) {
        //If the sum of two like signed terms is a diff sign, then the
        //signed result is outside [-128, 127], so set overflow flag
        this.flags.overflow= (num1 < 0x80 && num2 < 0x80 && reg >= 0x80) ||
                              (num1 >= 0x80 && num2 >= 0x80 && reg < 0x80);
    }

    private static updateNegativeFlag(register: number) {
        this.flags.negative = (register > 0x7F);
    }

    private static updateNumStateFlags(register: number) {
        this.flags.zero = (register === 0x00);
        this.updateNegativeFlag(register);
    }

    private static getRef(offset: number = 0): number {
        let addr = this.next2Bytes() + offset;
        if (this.debug) { console.log(`Accessing memory at 0x${
            addr.toString(16).padStart(4, "0").toUpperCase()}...`); }
        return addr;
    }

    private static getZPageRef(offset: number = 0): number {
        let addr = this.nextByte() + offset;
        addr -= (addr > 0xFF) ? 0x100 : 0;
        if (this.debug) { console.log(`Accessing memory at 0x${
            addr.toString(16).padStart(4, "0").toUpperCase()}...`); }
        return addr;
    }

    private static getIndrXRef(): number {
        let addr = this.getZPageRef(this.X);
        return combineHex(this.mem[addr+1], this.mem[addr]);
    }

    private static getIndrYRef(): number {
        let addr = this.getZPageRef();
        return combineHex(this.mem[addr+1], this.mem[addr]) + this.Y;
    }
}

let input = require('readline-sync');

if (process.argv.length > 2) {
    //Set flags based on arguments
    p6502.debug = (process.argv.indexOf("-d") !== -1
        || process.argv.indexOf("-D") !== -1);
    p6502.detectTraps = (process.argv.indexOf("-t") !== -1
        || process.argv.indexOf("-T") !== -1);

    let fileStr = process.argv[2];
    if (process.argv.indexOf("-p") !== -1
            || process.argv.indexOf("-p") !== -1) {
        p6502.loadProg(fileStr);
    } else {
        p6502.loadMemory(fileStr);
    }
} else {
    let hexStr = input.question("Please enter program hex: ");
    if (hexStr.length > 0) {
        p6502.loadProgStr(hexStr);
    }
    input = input.question("Debug? (y/n): ");
    p6502.debug = (input.indexOf("y") !== -1);
}

p6502.boot();
console.log("");
p6502.displayState();
