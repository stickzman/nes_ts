class CPU {
    public debug: boolean = false; //Output debug info
    //Stop execution when an infinite loop is detected
    public detectTraps: boolean = false;

    private readonly RES_VECT_LOC = 0xFFFC;
    private readonly INT_VECT_LOC = 0xFFFE;
    private readonly NMI_VECT_LOC = 0xFFFA;

    private mem: Uint8Array;

    private IRQ: boolean = false; //Interrupt Request signal line
    private NMI: boolean = false; //Non-Maskable Interrupt signal line

    private ACC: number;//Accumulator
    private X: number;  //Register X
    private Y: number;  //Register Y
    public PC: number = 0; //Program Counter
    private SP: number; //Stack Pointer
    private flags = {
        carry: false, //Last op caused overflow from bit 7 (or 0) of result
        zero: false, //Result of last op was 0
        interruptDisable: true, //Processor will ignore interrupts when true
        decimalMode: false, //Enables BCD arithmetic (ignored in NES)
        break: false, //Set when BRK op was executed
        overflow: false, //Arithmetic yielded invalid 2's complement result
        negative: false //Result of last op had bit 7 set to 1
    }

    constructor(memory: Uint8Array) {
        this.mem = memory;
    }

    public boot() {
        this.flags.interruptDisable = true;
        this.ACC = 0;
        this.X = 0;
        this.Y = 0;
        this.SP = 0xFD;
        this.mem[0x4015] = 0;
        this.mem[0x4017] = 0;
        this.mem.fill(0x00, 0x4000, 0x4010); //LSFR?
        this.PC = this.getResetVector();
    }

    public reset() {
        this.SP -= 3;
        this.flags.interruptDisable = true;
        this.mem[0x4015] = 0;
        this.PC = this.getResetVector();
    }

    public step() {
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
            let e = new Error(`Encountered unknown opCode: [0x${
                opCode.toString(16).toUpperCase()}] at PC: 0x${
                this.PC.toString(16).padStart(4, "0").toUpperCase()}`);
            e.name = "Unexpected OpCode";
            throw e;
        }

        if (this.debug) {
            console.log(`Executing ${op.name} at 0x${
                this.PC.toString(16).padStart(4, "0").toUpperCase()}...`);
        }

        op.execute.bind(this)();        //Execute

        if (this.debug) {
            this.displayState();
            console.log("");
        }

        this.PC += op.bytes;
    }

    public requestInterrupt() {
        this.IRQ = true;
    }

    public requestNMInterrupt() {
        this.NMI = true;
    }

    private handleInterrupt(resetVectStartAddr: number, setBRK = false) {
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

    private getResetVector(): number{
        let bytes = new Uint8Array(
                this.mem.slice(this.RES_VECT_LOC,this.RES_VECT_LOC+2));
        return combineHexBuff(bytes.reverse());
    }

    private pushStack(byte: number) {
        //Write byte to stack
        this.mem[combineHex(0x01, this.SP)] = byte;
        //Decrement stack pointer, wrap if necessary
        this.SP--;
        if (this.SP < 0) { this.SP = 0xFF; }
    }

    private pullStack(): number {
        this.SP++;
        if (this.SP > 0xFF) { this.SP = 0; }
        let byte = this.mem[combineHex(0x01, this.SP)];
        return byte;
    }

    public displayState() {
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

    private nextByte(): number {
        return this.mem[this.PC+1];
    }

    private next2Bytes(flip = true): number {
        let bytes = new Uint8Array(this.mem.slice(this.PC+1, this.PC+3));
        if (flip) {
            bytes.reverse();
        }
        return combineHexBuff(bytes);
    }

    private updateOverflowFlag(reg: number, num1: number, num2: number) {
        //If the sum of two like signed terms is a diff sign, then the
        //signed result is outside [-128, 127], so set overflow flag
        this.flags.overflow= (num1 < 0x80 && num2 < 0x80 && reg >= 0x80) ||
                              (num1 >= 0x80 && num2 >= 0x80 && reg < 0x80);
    }

    private updateNegativeFlag(register: number) {
        this.flags.negative = (register > 0x7F);
    }

    private updateNumStateFlags(register: number) {
        this.flags.zero = (register === 0x00);
        this.updateNegativeFlag(register);
    }

    private getRef(offset: number = 0): number {
        let addr = this.next2Bytes() + offset;
        if (this.debug) { console.log(`Accessing memory at 0x${
            addr.toString(16).padStart(4, "0").toUpperCase()}...`); }
        return addr;
    }

    private getZPageRef(offset: number = 0): number {
        let addr = this.nextByte() + offset;
        addr -= (addr > 0xFF) ? 0x100 : 0;
        if (this.debug) { console.log(`Accessing memory at 0x${
            addr.toString(16).padStart(4, "0").toUpperCase()}...`); }
        return addr;
    }

    private getIndrXRef(): number {
        let addr = this.getZPageRef(this.X);
        return combineHex(this.mem[addr+1], this.mem[addr]);
    }

    private getIndrYRef(): number {
        let addr = this.getZPageRef();
        return combineHex(this.mem[addr+1], this.mem[addr]) + this.Y;
    }
}



//OpCodes Start

interface opTable {
    [code: string]: {
        name: string,
        bytes: number,
        cycles: number,
        execute: Function
    }
}

let opTable: opTable = {};
opTable[0x00] = {
    name: "BRK",
    bytes: 0,
    cycles: 7,
    execute: function() {
        this.PC += 2;
        this.handleInterrupt(this.INT_VECT_LOC, true);
    }
}

opTable[0xA9] = {
    name: "LDA (imm)", //Load Accumulator with constant (Immediate)
    bytes: 2,
    cycles: 2,
    execute: function() {
        this.ACC = this.nextByte();
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0xAD] = {
    name: "LDA (abs)", //Load Accumulator from memory location (Absolute)
    bytes: 3,
    cycles: 4,
    execute: function() {
        let addr = this.getRef();
        this.ACC = this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0xBD] = {
    name: "LDA (abs, X)",
    bytes: 3,
    cycles: 4,
    execute: function() {
        let addr = this.getRef(this.X);
        this.ACC = this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0xB9] = {
    name: "LDA (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function() {
        let addr = this.getRef(this.Y);
        this.ACC = this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0xA5] = {
    name: "LDA (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function() {
        let addr = this.getZPageRef();
        this.ACC = this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0xB5] = {
    name: "LDA (zpg, X)",
    bytes: 2,
    cycles: 4,
    execute: function() {
        let addr = this.getZPageRef(this.X);
        this.ACC = this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0xA1] = {
    name: "LDA (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function() {
        let addr = this.getIndrXRef();
        this.ACC = this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0xB1] = {
    name: "LDA (ind), Y",
    bytes: 2,
    cycles: 5,
    execute: function() {
        let addr = this.getIndrYRef();
        this.ACC = this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
}

opTable[0xA2] = {
    name: "LDX (imm)", //Load X with constant
    bytes: 2,
    cycles: 2,
    execute: function() {
        this.X = this.nextByte();
        this.updateNumStateFlags(this.X);
    }
}
opTable[0xA6] = {
    name: "LDX (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function() {
        let addr = this.getZPageRef();
        this.X = this.mem[addr];
        this.updateNumStateFlags(this.X);
    }
}
opTable[0xB6] = {
    name: "LDX (zpg, Y)",
    bytes: 2,
    cycles: 4,
    execute: function() {
        let addr = this.getZPageRef(this.Y);
        this.X = this.mem[addr];
        this.updateNumStateFlags(this.X);
    }
}
opTable[0xAE] = {
    name: "LDX (abs)", //Load X from memory
    bytes: 3,
    cycles: 4,
    execute: function() {
        let addr = this.getRef();
        this.X = this.mem[addr];
        this.updateNumStateFlags(this.X);
    }
}
opTable[0xBE] = {
    name: "LDX (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function() {
        let addr = this.getRef(this.Y);
        this.X = this.mem[addr];
        this.updateNumStateFlags(this.X);
    }
}

opTable[0xA0] = {
    name: "LDY (imm)", //Load Y with constant
    bytes: 2,
    cycles: 2,
    execute: function() {
        this.Y = this.nextByte();
        this.updateNumStateFlags(this.Y);
    }
}
opTable[0xA4] = {
    name: "LDY (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function() {
        let addr = this.getZPageRef();
        this.Y = this.mem[addr];
        this.updateNumStateFlags(this.Y);
    }
}
opTable[0xB4] = {
    name: "LDY (zpg, X)",
    bytes: 2,
    cycles: 4,
    execute: function() {
        let addr = this.getZPageRef(this.X);
        this.Y = this.mem[addr];
        this.updateNumStateFlags(this.Y);
    }
}
opTable[0xAC] = {
    name: "LDY (abs)", //Load Y with constant
    bytes: 3,
    cycles: 4,
    execute: function() {
        let addr = this.getRef();
        this.Y = this.mem[addr];
        this.updateNumStateFlags(this.Y);
    }
}
opTable[0xBC] = {
    name: "LDY (abs, X)",
    bytes: 3,
    cycles: 4,
    execute: function() {
        let addr = this.getRef(this.X);
        this.Y = this.mem[addr];
        this.updateNumStateFlags(this.Y);
    }
}

opTable[0x85] = {
    name: "STA (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function() {
        let addr = this.getZPageRef();
        this.mem[addr] = this.ACC;
    }
}
opTable[0x95] = {
    name: "STA (zpg, X)",
    bytes: 2,
    cycles: 4,
    execute: function() {
        let addr = this.getZPageRef(this.X);
        this.mem[addr] = this.ACC;
    }
}
opTable[0x8D] = {
    name: "STA (abs)",
    bytes: 3,
    cycles: 4,
    execute: function() {
        let addr = this.getRef();
        this.mem[addr] = this.ACC;
    }
}
opTable[0x9D] = {
    name: "STA (abs, X)",
    bytes: 3,
    cycles: 4,
    execute: function() {
        let addr = this.getRef(this.X);
        this.mem[addr] = this.ACC;
    }
}
opTable[0x99] = {
    name: "STA (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function() {
        let addr = this.getRef(this.Y);
        this.mem[addr] = this.ACC;
    }
}
opTable[0x81] = {
    name: "STA (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function() {
        let addr = this.getIndrXRef();
        this.mem[addr] = this.ACC;
    }
}
opTable[0x91] = {
    name: "STA (ind), Y",
    bytes: 2,
    cycles: 5,
    execute: function() {
        let addr = this.getIndrYRef();
        this.mem[addr] = this.ACC;
    }
}

opTable[0x86] = {
    name: "STX (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function() {
        let addr = this.getZPageRef();
        this.mem[addr] = this.X;
    }
}
opTable[0x96] = {
    name: "STX (zpg, Y)",
    bytes: 2,
    cycles: 4,
    execute: function() {
        let addr = this.getZPageRef(this.Y);
        this.mem[addr] = this.X;
    }
}
opTable[0x8E] = {
    name: "STX (abs)",
    bytes: 3,
    cycles: 4,
    execute: function() {
        let addr = this.getRef();
        this.mem[addr] = this.X;
    }
}

opTable[0x84] = {
    name: "STY (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function() {
        let addr = this.getZPageRef();
        this.mem[addr] = this.Y;
    }
}
opTable[0x94] = {
    name: "STY (zpg, Y)",
    bytes: 2,
    cycles: 4,
    execute: function() {
        let addr = this.getZPageRef(this.X);
        this.mem[addr] = this.Y;
    }
}
opTable[0x8C] = {
    name: "STY (abs)",
    bytes: 3,
    cycles: 4,
    execute: function() {
        let addr = this.getRef();
        this.mem[addr] = this.Y;
    }
}

opTable[0xAA] = {
    name: "TAX",
    bytes: 1,
    cycles: 2,
    execute: function() {
        this.X = this.ACC;
        this.updateNumStateFlags(this.X);
    }
}
opTable[0xA8] = {
    name: "TAY",
    bytes: 1,
    cycles: 2,
    execute: function() {
        this.Y = this.ACC;
        this.updateNumStateFlags(this.Y);
    }
}
opTable[0xBA] = {
    name: "TSX",
    bytes: 1,
    cycles: 2,
    execute: function() {
        this.X = this.SP;
        this.updateNumStateFlags(this.X);
    }
}
opTable[0x8A] = {
    name: "TXA",
    bytes: 1,
    cycles: 2,
    execute: function() {
        this.ACC= this.X;
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0x9A] = {
    name: "TXS",
    bytes: 1,
    cycles: 2,
    execute: function() {
        this.SP = this.X;
    }
}
opTable[0x98] = {
    name: "TYA",
    bytes: 1,
    cycles: 2,
    execute: function() {
        this.ACC = this.Y;
        this.updateNumStateFlags(this.Y);
    }
}

function ADC(num: number) {
    if (this.flags.decimalMode) {
        //Convert current 2 digit hex to literal 2 digit decimal
        let num2 = parseInt(this.ACC.toString(16));
        num = parseInt(num.toString(16));
        let res = num + num2 + this.flags.carry;
        if (res > 99) {
            this.flags.carry = true;
            res -= 100;
        } else {
            this.flags.carry = false;
        }
        this.ACC = parseInt(res.toString(), 16);
    } else {
        let num2 = this.ACC;
        this.ACC += num + this.flags.carry;
        //Wrap ACC and set/clear carry flag
        if (this.ACC > 0xFF) {
            this.flags.carry = true;
            this.ACC -= 0x100;
        } else {
            this.flags.carry = false;
        }
        ///Set/clear overflow flag
        this.updateOverflowFlag(this.ACC, num, num2);
        //Set/clear negative + zero flags
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0x69] = {
    name: "ADC (imm)", //Adds constant to ACC
    bytes: 2,
    cycles: 2,
    execute: function() {
        ADC.call(this, this.nextByte());
    }
}
opTable[0x65] = {
    name: "ADC (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function() {
        let addr = this.getZPageRef();
        ADC.call(this, this.mem[addr]);
    }
}
opTable[0x75] = {
    name: "ADC (zpg, X)",
    bytes: 2,
    cycles: 4,
    execute: function() {
        let addr = this.getZPageRef(this.X);
        ADC.call(this, this.mem[addr]);
    }
}
opTable[0x6D] = {
    name: "ADC (abs)", //Add contents at memory location to ACC
    bytes: 3,
    cycles: 4,
    execute: function() {
        let addr = this.getRef();
        ADC.call(this, this.mem[addr]);
    }
}
opTable[0x7D] = {
    name: "ADC (abs, X)",
    bytes: 3,
    cycles: 4,
    execute: function() {
        let addr = this.getRef(this.X);
        ADC.call(this, this.mem[addr]);
    }
}
opTable[0x79] = {
    name: "ADC (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function() {
        let addr = this.getRef(this.Y);
        ADC.call(this, this.mem[addr]);
    }
}
opTable[0x61] = {
    name: "ADC (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function() {
        let addr = this.getIndrXRef();
        ADC.call(this, this.mem[addr]);
    }
}
opTable[0x71] = {
    name: "ADC (ind), Y",
    bytes: 2,
    cycles: 6,
    execute: function() {
        let addr = this.getIndrYRef();
        ADC.call(this, this.mem[addr]);
    }
}

function SBC(num: number) {
    if (this.flags.decimalMode) {
        //Convert current 2 digit hex to literal 2 digit decimal
        let num2 = parseInt(this.ACC.toString(16));
        num = parseInt(num.toString(16));
        let res = num2 - num;
        res -= (this.flags.carry) ? 0 : 1;
        if (res < 0) {
            this.flags.carry = false;
            res += 100;
        } else {
            this.flags.carry = true;
        }
        this.ACC = parseInt(res.toString(), 16);
    } else {
        let mask = 0xFF;
        let flipBits = num ^ mask;
        ADC.call(this, flipBits);
    }
}
opTable[0xE9] = {
    name: "SBC (imm)",
    bytes: 2,
    cycles: 2,
    execute: function() {
        SBC.call(this, this.nextByte());
    }
}
opTable[0xE5] = {
    name: "SBC (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function() {
        let num = this.mem[this.getZPageRef()];
        SBC.call(this, num);
    }
}
opTable[0xF5] = {
    name: "SBC (zpg, X)",
    bytes: 2,
    cycles: 4,
    execute: function() {
        let num = this.mem[this.getZPageRef(this.X)];
        SBC.call(this, num);
    }
}
opTable[0xED] = {
    name: "SBC (abs)",
    bytes: 3,
    cycles: 4,
    execute: function() {
        let num = this.mem[this.getRef()];
        SBC.call(this, num);
    }
}
opTable[0xFD] = {
    name: "SBC (abs, X)",
    bytes: 3,
    cycles: 4,
    execute: function() {
        let num = this.mem[this.getRef(this.X)];
        SBC.call(this, num);
    }
}
opTable[0xF9] = {
    name: "SBC (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function() {
        let num = this.mem[this.getRef(this.Y)];
        SBC.call(this, num);
    }
}
opTable[0xE1] = {
    name: "SBC (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function() {
        let num = this.mem[this.getIndrXRef()];
        SBC.call(this, num);
    }
}
opTable[0xF1] = {
    name: "SBC (ind), Y",
    bytes: 2,
    cycles: 6,
    execute: function() {
        let num = this.mem[this.getIndrYRef()];
        SBC.call(this, num);
    }
}

opTable[0xEA] = {
    name: "NOP", //No operation
    bytes: 1,
    cycles: 1,
    execute: function() { }
}

opTable[0xE6] = {
    name: "INC (zpg)", //Increment byte in memory by 1
    bytes: 2,
    cycles: 5,
    execute: function() {
        let addr = this.getZPageRef();
        this.mem[addr] = addWrap(this.mem[addr], 1);
        this.updateNumStateFlags(this.mem[addr]);
    }
}
opTable[0xF6] = {
    name: "INC (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function() {
        let addr = this.getZPageRef(this.X);
        this.mem[addr] = addWrap(this.mem[addr], 1);
        this.updateNumStateFlags(this.mem[addr]);
    }
}
opTable[0xEE] = {
    name: "INC (abs)",
    bytes: 3,
    cycles: 6,
    execute: function() {
        let addr = this.getRef();
        this.mem[addr] = addWrap(this.mem[addr], 1);
        this.updateNumStateFlags(this.mem[addr]);
    }
}
opTable[0xFE] = {
    name: "INC (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function() {
        let addr = this.getRef(this.X);
        this.mem[addr] = addWrap(this.mem[addr], 1);
        this.updateNumStateFlags(this.mem[addr]);
    }
}

opTable[0xE8] = {
    name: "INX",
    bytes: 1,
    cycles: 2,
    execute: function() {
        this.X = addWrap(this.X, 1);
        this.updateNumStateFlags(this.X);
    }
}
opTable[0xC8] = {
    name: "INY",
    bytes: 1,
    cycles: 2,
    execute: function() {
        this.Y = addWrap(this.Y, 1);
        this.updateNumStateFlags(this.Y);
    }
}

opTable[0xC6] = {
    name: "DEC (zpg)", //Decrement byte in memory by 1
    bytes: 2,
    cycles: 5,
    execute: function() {
        let addr = this.getZPageRef();
        this.mem[addr] = addWrap(this.mem[addr], -1);
        this.updateNumStateFlags(this.mem[addr]);
    }
}
opTable[0xD6] = {
    name: "DEC (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function() {
        let addr = this.getZPageRef(this.X);
        this.mem[addr] = addWrap(this.mem[addr], -1);
        this.updateNumStateFlags(this.mem[addr]);
    }
}
opTable[0xCE] = {
    name: "DEC (abs)",
    bytes: 3,
    cycles: 3,
    execute: function() {
        let addr = this.getRef();
        this.mem[addr] = addWrap(this.mem[addr], -1);
        this.updateNumStateFlags(this.mem[addr]);
    }
}
opTable[0xDE] = {
    name: "DEC (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function() {
        let addr = this.getRef(this.X);
        this.mem[addr] = addWrap(this.mem[addr], -1);
        this.updateNumStateFlags(this.mem[addr]);
    }
}

opTable[0xCA] = {
    name: "DEX",
    bytes: 1,
    cycles: 2,
    execute: function() {
        this.X = addWrap(this.X, -1);
        this.updateNumStateFlags(this.X);
    }
}
opTable[0x88] = {
    name: "DEY",
    bytes: 1,
    cycles: 2,
    execute: function() {
        this.Y = addWrap(this.Y, -1);
        this.updateNumStateFlags(this.Y);
    }
}

opTable[0x18] = {
    name: "CLC",
    bytes: 1,
    cycles: 2,
    execute: function() {
        this.flags.carry = false;
    }
}
opTable[0xD8] = {
    name: "CLD",
    bytes: 1,
    cycles: 2,
    execute: function() {
        this.flags.decimalMode = false;
    }
}
opTable[0xB8] = {
    name: "CLV",
    bytes: 1,
    cycles: 2,
    execute: function() {
        this.flags.overflow = false;
    }
}
opTable[0x58] = {
    name: "CLI",
    bytes: 1,
    cycles: 2,
    execute: function() {
        this.flags.interruptDisable = false;
    }
}

opTable[0x38] = {
    name: "SEC",
    bytes: 1,
    cycles: 2,
    execute: function() {
        this.flags.carry = true;
    }
}
opTable[0xF8] = {
    name: "SED",
    bytes: 1,
    cycles: 2,
    execute: function() {
        this.flags.decimalMode = true;
    }
}
opTable[0x78] = {
    name: "SEI",
    bytes: 1,
    cycles: 2,
    execute: function() {
        this.flags.interruptDisable = true;
    }
}

function CMP(num: number, register: number) {
    this.flags.zero = (register == num);
    let res = register - num;
    res += (res < 0) ? 0x10000 : 0;
    this.updateNegativeFlag(res);
    this.flags.carry = (register >= num);
}
opTable[0xC9] = {
    name: "CMP (imm)",
    bytes: 2,
    cycles: 2,
    execute: function() {
        CMP.call(this, this.nextByte(), this.ACC);
    }
}
opTable[0xC5] = {
    name: "CMP (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function() {
        CMP.call(this, this.mem[this.getZPageRef()], this.ACC);
    }
}
opTable[0xD5] = {
    name: "CMP (zpg, X)",
    bytes: 2,
    cycles: 4,
    execute: function() {
        CMP.call(this, this.mem[this.getZPageRef(this.X)], this.ACC);
    }
}
opTable[0xCD] = {
    name: "CMP (abs)",
    bytes: 3,
    cycles: 4,
    execute: function() {
        CMP.call(this, this.mem[this.getRef()], this.ACC);
    }
}
opTable[0xDD] = {
    name: "CMP (abs, X)",
    bytes: 3,
    cycles: 4,
    execute: function() {
        CMP.call(this, this.mem[this.getRef(this.X)], this.ACC);
    }
}
opTable[0xD9] = {
    name: "CMP (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function() {
        CMP.call(this, this.mem[this.getRef(this.Y)], this.ACC);
    }
}
opTable[0xC1] = {
    name: "CMP (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function() {
        CMP.call(this, this.mem[this.getIndrXRef()], this.ACC);
    }
}
opTable[0xD1] = {
    name: "CMP (ind), Y",
    bytes: 2,
    cycles: 5,
    execute: function() {
        CMP.call(this, this.mem[this.getIndrYRef()], this.ACC);
    }
}
opTable[0xE0] = {
    name: "CPX (imm)",
    bytes: 2,
    cycles: 2,
    execute: function() {
        CMP.call(this, this.nextByte(), this.X);
    }
}
opTable[0xE4] = {
    name: "CPX (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function() {
        CMP.call(this, this.mem[this.getZPageRef()], this.X);
    }
}
opTable[0xEC] = {
    name: "CPX (abs)",
    bytes: 3,
    cycles: 4,
    execute: function() {
        CMP.call(this, this.mem[this.getRef()], this.X);
    }
}
opTable[0xC0] = {
    name: "CPY (imm)",
    bytes: 2,
    cycles: 2,
    execute: function() {
        CMP.call(this, this.nextByte(), this.Y);
    }
}
opTable[0xC4] = {
    name: "CPY (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function() {
        CMP.call(this, this.mem[this.getZPageRef()], this.Y);
    }
}
opTable[0xCC] = {
    name: "CPY (abs)",
    bytes: 3,
    cycles: 4,
    execute: function() {
        CMP.call(this, this.mem[this.getRef()], this.Y);
    }
}

opTable[0x29] = {
    name: "AND (imm)", //ACC AND const -> ACC
    bytes: 2,
    cycles: 2,
    execute: function() {
        this.ACC = this.ACC & this.nextByte();
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0x25] = {
    name: "AND (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function() {
        this.ACC = this.ACC & this.mem[this.getZPageRef()];
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0x35] = {
    name: "AND (zpg, X)",
    bytes: 2,
    cycles: 4,
    execute: function() {
        this.ACC = this.ACC & this.mem[this.getZPageRef(this.X)];
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0x2D] = {
    name: "AND (abs)",
    bytes: 3,
    cycles: 4,
    execute: function() {
        this.ACC = this.ACC & this.mem[this.getRef()];
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0x3D] = {
    name: "AND (abs, X)",
    bytes: 3,
    cycles: 4,
    execute: function() {
        this.ACC = this.ACC & this.mem[this.getRef(this.X)];
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0x39] = {
    name: "AND (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function() {
        this.ACC = this.ACC & this.mem[this.getRef(this.Y)];
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0x21] = {
    name: "AND (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function() {
        this.ACC = this.ACC & this.mem[this.getIndrXRef()];
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0x31] = {
    name: "AND (ind), Y",
    bytes: 2,
    cycles: 5,
    execute: function() {
        this.ACC = this.ACC & this.mem[this.getIndrYRef()];
        this.updateNumStateFlags(this.ACC);
    }
}

opTable[0x09] = {
    name: "ORA (imm)", //ACC OR const -> ACC
    bytes: 2,
    cycles: 2,
    execute: function() {
        this.ACC = this.ACC | this.nextByte();
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0x05] = {
    name: "ORA (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function() {
        this.ACC = this.ACC | this.mem[this.getZPageRef()];
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0x15] = {
    name: "ORA (zpg, X)",
    bytes: 2,
    cycles: 4,
    execute: function() {
        this.ACC = this.ACC | this.mem[this.getZPageRef(this.X)];
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0x0D] = {
    name: "ORA (abs)",
    bytes: 3,
    cycles: 4,
    execute: function() {
        this.ACC = this.ACC | this.mem[this.getRef()];
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0x1D] = {
    name: "ORA (abs, X)",
    bytes: 3,
    cycles: 4,
    execute: function() {
        this.ACC = this.ACC | this.mem[this.getRef(this.X)];
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0x19] = {
    name: "ORA (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function() {
        this.ACC = this.ACC | this.mem[this.getRef(this.Y)];
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0x01] = {
    name: "ORA (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function() {
        this.ACC = this.ACC | this.mem[this.getIndrXRef()];
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0x11] = {
    name: "ORA (ind), Y",
    bytes: 2,
    cycles: 5,
    execute: function() {
        this.ACC = this.ACC | this.mem[this.getIndrYRef()];
        this.updateNumStateFlags(this.ACC);
    }
}

opTable[0x49] = {
    name: "EOR (imm)", //ACC XOR const -> ACC
    bytes: 2,
    cycles: 2,
    execute: function() {
        this.ACC = this.ACC ^ this.nextByte();
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0x45] = {
    name: "EOR (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function() {
        this.ACC = this.ACC ^ this.mem[this.getZPageRef()];
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0x55] = {
    name: "EOR (zpg, X)",
    bytes: 2,
    cycles: 4,
    execute: function() {
        this.ACC = this.ACC ^ this.mem[this.getZPageRef(this.X)];
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0x4D] = {
    name: "EOR (abs)",
    bytes: 3,
    cycles: 4,
    execute: function() {
        this.ACC = this.ACC ^ this.mem[this.getRef()];
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0x5D] = {
    name: "EOR (abs, X)",
    bytes: 3,
    cycles: 4,
    execute: function() {
        this.ACC = this.ACC ^ this.mem[this.getRef(this.X)];
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0x59] = {
    name: "EOR (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function() {
        this.ACC = this.ACC ^ this.mem[this.getRef(this.Y)];
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0x41] = {
    name: "EOR (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function() {
        this.ACC = this.ACC ^ this.mem[this.getIndrXRef()];
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0x51] = {
    name: "EOR (ind), Y",
    bytes: 2,
    cycles: 5,
    execute: function() {
        this.ACC = this.ACC ^ this.mem[this.getIndrYRef()];
        this.updateNumStateFlags(this.ACC);
    }
}

opTable[0x0A] = {
    name: "ASL",
    bytes: 1,
    cycles: 2,
    execute: function() {
        this.flags.carry = (this.ACC >= 0x80);
        this.ACC = this.ACC << 1;
        this.ACC -= (this.flags.carry) ? 0x100 : 0;
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0x06] = {
    name: "ASL (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function() {
        let addr = this.getZPageRef();
        this.flags.carry = (this.mem[addr] >= 0x80);
        this.mem[addr] = this.mem[addr] << 1;
        this.mem[addr] -= (this.flags.carry) ? 0x100 : 0;
        this.updateNumStateFlags(this.mem[addr]);
    }
}
opTable[0x16] = {
    name: "ASL (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function() {
        let addr = this.getZPageRef(this.X);
        this.flags.carry = (this.mem[addr] >= 0x80);
        this.mem[addr] = this.mem[addr] << 1;
        this.mem[addr] -= (this.flags.carry) ? 0x100 : 0;
        this.updateNumStateFlags(this.mem[addr]);
    }
}
opTable[0x0E] = {
    name: "ASL (abs)",
    bytes: 3,
    cycles: 6,
    execute: function() {
        let addr = this.getRef();
        this.flags.carry = (this.mem[addr] >= 0x80);
        this.mem[addr] = this.mem[addr] << 1;
        this.mem[addr] -= (this.flags.carry) ? 0x100 : 0;
        this.updateNumStateFlags(this.mem[addr]);
    }
}
opTable[0x1E] = {
    name: "ASL (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function() {
        let addr = this.getRef(this.X);
        this.flags.carry = (this.mem[addr] >= 0x80);
        this.mem[addr] = this.mem[addr] << 1;
        this.mem[addr] -= (this.flags.carry) ? 0x100 : 0;
        this.updateNumStateFlags(this.mem[addr]);
    }
}

opTable[0x4A] = {
    name: "LSR",
    bytes: 1,
    cycles: 2,
    execute: function() {
        this.flags.carry = (this.ACC % 2 == 1);
        this.ACC = this.ACC >> 1;
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0x46] = {
    name: "LSR (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function() {
        let addr = this.getZPageRef();
        this.flags.carry = (this.mem[addr] % 2 == 1);
        this.mem[addr] = this.mem[addr] >> 1;
        this.updateNumStateFlags(this.mem[addr]);
    }
}
opTable[0x56] = {
    name: "LSR (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function() {
        let addr = this.getZPageRef(this.X);
        this.flags.carry = (this.mem[addr] % 2 == 1);
        this.mem[addr] = this.mem[addr] >> 1;
        this.updateNumStateFlags(this.mem[addr]);
    }
}
opTable[0x4E] = {
    name: "LSR (abs)",
    bytes: 3,
    cycles: 6,
    execute: function() {
        let addr = this.getRef();
        this.flags.carry = (this.mem[addr] % 2 == 1);
        this.mem[addr] = this.mem[addr] >> 1;
        this.updateNumStateFlags(this.mem[addr]);
    }
}
opTable[0x5E] = {
    name: "LSR (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function() {
        let addr = this.getRef(this.X);
        this.flags.carry = (this.mem[addr] % 2 == 1);
        this.mem[addr] = this.mem[addr] >> 1;
        this.updateNumStateFlags(this.mem[addr]);
    }
}

opTable[0x24] = {
    name: "BIT (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function() {
        let addr = this.getZPageRef();
        let res = this.ACC & this.mem[addr];
        this.flags.zero = (res == 0x00);
        this.updateNegativeFlag(this.mem[addr]);
        let mask = 1 << 6; //6th bit mask
        this.flags.overflow = ((this.mem[addr] & mask) != 0);
    }
}
opTable[0x2C] = {
    name: "BIT (abs)",
    bytes: 3,
    cycles: 4,
    execute: function() {
        let addr = this.getRef();
        let res = this.ACC & this.mem[addr];
        this.flags.zero = (res == 0x00);
        this.updateNegativeFlag(this.mem[addr]);
        let mask = 1 << 6; //6th bit mask
        this.flags.overflow = ((this.mem[addr] & mask) != 0);
    }
}

opTable[0x2A] = {
    name: "ROL",
    bytes: 1,
    cycles: 2,
    execute: function() {
        //Store current carry bit for later
        let addBit = this.flags.carry;
        //Move MSB to carry flag
        this.flags.carry = (this.ACC >= 0x80);
        //Shift one place to the left
        this.ACC = this.ACC << 1;
        //Drop MSB
        this.ACC -= (this.flags.carry) ? 0x100 : 0;
        //Make the prev carry bit the LSB
        this.ACC += addBit;
        //Update flags
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0x26] = {
    name: "ROL (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function() {
        let addr = this.getZPageRef();
        let addBit = this.flags.carry;
        this.flags.carry = (this.mem[addr] >= 0x80);
        this.mem[addr] = this.mem[addr] << 1;
        this.mem[addr] -= (this.flags.carry) ? 0x100 : 0;
        this.mem[addr] += addBit;
        this.updateNumStateFlags(this.mem[addr]);
    }
}
opTable[0x36] = {
    name: "ROL (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function() {
        let addr = this.getZPageRef(this.X);
        let addBit = this.flags.carry;
        this.flags.carry = (this.mem[addr] >= 0x80);
        this.mem[addr] = this.mem[addr] << 1;
        this.mem[addr] -= (this.flags.carry) ? 0x100 : 0;
        this.mem[addr] += addBit;
        this.updateNumStateFlags(this.mem[addr]);
    }
}
opTable[0x2E] = {
    name: "ROL (abs)",
    bytes: 3,
    cycles: 6,
    execute: function() {
        let addr = this.getRef();
        let addBit = this.flags.carry;
        this.flags.carry = (this.mem[addr] >= 0x80);
        this.mem[addr] = this.mem[addr] << 1;
        this.mem[addr] -= (this.flags.carry) ? 0x100 : 0;
        this.mem[addr] += addBit;
        this.updateNumStateFlags(this.mem[addr]);
    }
}
opTable[0x3E] = {
    name: "ROL (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function() {
        let addr = this.getRef(this.X);
        let addBit = this.flags.carry;
        this.flags.carry = (this.mem[addr] >= 0x80);
        this.mem[addr] = this.mem[addr] << 1;
        this.mem[addr] -= (this.flags.carry) ? 0x100 : 0;
        this.mem[addr] += addBit;
        this.updateNumStateFlags(this.mem[addr]);
    }
}

opTable[0x6A] = {
    name: "ROR",
    bytes: 1,
    cycles: 2,
    execute: function() {
        //Store current carry bit for later
        let addBit = (this.flags.carry) ? 0x80 : 0;
        //Move LSB to carry flag
        this.flags.carry = (this.ACC % 2 == 1);
        //Shift number one place to the right
        this.ACC = this.ACC >> 1;
        //Make the prev carry bit the MSB
        this.ACC += addBit;
        //Update flags
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0x66] = {
    name: "ROR (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function() {
        let addr = this.getZPageRef();
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.mem[addr] % 2 == 1);
        this.mem[addr] = this.mem[addr] >> 1;
        this.mem[addr] += addBit;
        this.updateNumStateFlags(this.mem[addr]);
    }
}
opTable[0x76] = {
    name: "ROR (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function() {
        let addr = this.getZPageRef(this.X);
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.mem[addr] % 2 == 1);
        this.mem[addr] = this.mem[addr] >> 1;
        this.mem[addr] += addBit;
        this.updateNumStateFlags(this.mem[addr]);
    }
}
opTable[0x6E] = {
    name: "ROR (abs)",
    bytes: 3,
    cycles: 6,
    execute: function() {
        let addr = this.getRef();
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.mem[addr] % 2 == 1);
        this.mem[addr] = this.mem[addr] >> 1;
        this.mem[addr] += addBit;
        this.updateNumStateFlags(this.mem[addr]);
    }
}
opTable[0x7E] = {
    name: "ROR (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function() {
        let addr = this.getRef(this.X);
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.mem[addr] % 2 == 1);
        this.mem[addr] = this.mem[addr] >> 1;
        this.mem[addr] += addBit;
        this.updateNumStateFlags(this.mem[addr]);
    }
}

function branch() {
    let dist = this.nextByte();
    dist -= (dist < 0x80) ? 0 : 0x100;
    if (this.debug) {
        console.log(`Branching ${dist} bytes...`);
    }
    if (dist == -2 && this.detectTraps) {
        console.log(`TRAPPED at 0x${
            this.PC.toString(16).padStart(4,"0").toUpperCase()}`);
        this.flags.break = true;
    }
    this.PC += dist;
}
opTable[0x90] = {
    name: "BCC", //Branch if Carry Clear
    bytes: 2,
    cycles: 2,
    execute: function() {
        if (!this.flags.carry) {
            branch.call(this);
        }
    }
}
opTable[0xB0] = {
    name: "BCS", //Branch if Carry Set
    bytes: 2,
    cycles: 2,
    execute: function() {
        if (this.flags.carry) {
            branch.call(this);
        }
    }
}
opTable[0x30] = {
    name: "BMI", //Branch if Minus (negative set)
    bytes: 2,
    cycles: 2,
    execute: function() {
        if (this.flags.negative) {
            branch.call(this);
        }
    }
}
opTable[0x10] = {
    name: "BPL", //Branch if Positive (negative clear)
    bytes: 2,
    cycles: 2,
    execute: function() {
        if (!this.flags.negative) {
            branch.call(this);
        }
    }
}
opTable[0xF0] = {
    name: "BEQ", //Branch if Equal (zero set)
    bytes: 2,
    cycles: 2,
    execute: function() {
        if (this.flags.zero) {
            branch.call(this);
        }
    }
}
opTable[0xD0] = {
    name: "BNE", //Branch Not Equal (zero clear)
    bytes: 2,
    cycles: 2, //TODO: Adjust cycles conditionally
    execute: function() {
        if (!this.flags.zero) {
            branch.call(this);
        }
    }
}
opTable[0x50] = {
    name: "BVC", //Branch if Overflow Clear
    bytes: 2,
    cycles: 2,
    execute: function() {
        if (!this.flags.overflow) {
            branch.call(this);
        }
    }
}
opTable[0x70] = {
    name: "BVS", //Branch if Overflow Set
    bytes: 2,
    cycles: 2,
    execute: function() {
        if (this.flags.overflow) {
            branch.call(this);
        }
    }
}

opTable[0x4C] = {
    name: "JMP (abs)",
    bytes: 3,
    cycles: 3,
    execute: function() {
        let addr = this.getRef();
        if (this.debug) {
            console.log(`Jumping to location 0x${
                addr.toString(16).padStart(4, "0")}...`);
        }
        if (addr == this.PC  && this.detectTraps) {
            console.log(`TRAPPED at 0x${
                this.PC.toString(16).padStart(4,"0").toUpperCase()}`);
            this.flags.break = true;
        }
        this.PC = addr - 3;
    }
}
opTable[0x6C] = {
    name: "JMP (ind)",
    bytes: 3,
    cycles: 5,
    execute: function() {
        let indAddr = this.next2Bytes();
        let addr = combineHex(this.mem[indAddr+1], this.mem[indAddr]);
        if (this.debug) {
            console.log(`Jumping to location 0x${addr}...`);
        }
        if (addr == this.PC  && this.detectTraps) {
            console.log(`TRAPPED at 0x${
                this.PC.toString(16).padStart(4,"0").toUpperCase()}`);
            this.flags.break = true;
        }
        this.PC = addr - 3;
    }
}

opTable[0x20] = {
    name: "JSR", //Jump to Subroutine
    bytes: 3,
    cycles: 6,
    execute: function() {
        let addr = this.getRef();
        if (this.debug) {
            console.log(`Jumping to subroutine at 0x${
                addr.toString(16).padStart(4, "0").toUpperCase()}...`);
        }
        //Split PC and add each addr byte to stack
        let bytes = splitHex(this.PC + 2);
        this.pushStack(bytes[0]);
        this.pushStack(bytes[1]);
        this.PC = addr - 3;
    }
}
opTable[0x60] = {
    name: "RTS", //Return from Subroutine
    bytes: 1,
    cycles: 6,
    execute: function() {
        let loByte = this.pullStack();
        let hiByte = this.pullStack();
        let addr = combineHex(hiByte, loByte);
        if (this.debug) {
            console.log(`Return to location 0x${
                addr.toString(16).padStart(4, "0").toUpperCase()
                } from subroutine...`);
        }
        this.PC = addr;
    }
}

opTable[0x48] = {
    name: "PHA", //Push Accumulator to stack
    bytes: 1,
    cycles: 3,
    execute: function() {
        this.pushStack(this.ACC);
    }
}

opTable[0x08] = {
    name: "PHP", //Push Processor status (all flags, stored in a byte) to stack
    bytes: 1,
    cycles: 3,
    execute: function() {
        let statusByte = 0x00;
        //Set each bit accoriding to flags
        statusByte += (this.flags.carry) ? 1 : 0;
        statusByte += (this.flags.zero) ? 2 : 0;
        statusByte += (this.flags.interruptDisable) ? 4 : 0;
        statusByte += (this.flags.decimalMode) ? 8 : 0;
        statusByte += 16; //Always set the break bit from software
        statusByte += 32; //This bit always set
        statusByte += (this.flags.overflow) ? 64 : 0;
        statusByte += (this.flags.negative) ? 128 : 0;
        this.pushStack(statusByte);
    }
}
opTable[0x68] = {
    name: "PLA", //Pull Accumulator from stack
    bytes: 1,
    cycles: 4,
    execute: function() {
        this.ACC = this.pullStack();
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0x28] = {
    name: "PLP", //Pull Processor status from stack
    bytes: 1,
    cycles: 4,
    execute: function() {
        let sByte = this.pullStack();
        //Adjust mask and check each indv bit for each flag
        let mask = 1;
        this.flags.carry = ((sByte & mask) != 0);
        mask = 1 << 1;
        this.flags.zero = ((sByte & mask) != 0);
        mask = 1 << 2;
        this.flags.interruptDisable = ((sByte & mask) != 0);
        mask = 1 << 3;
        this.flags.decimalMode = ((sByte & mask) != 0);
        mask = 1 << 6;
        this.flags.overflow = ((sByte & mask) != 0);
        mask = 1 << 7;
        this.flags.negative = ((sByte & mask) != 0);
    }
}

opTable[0x40] = {
    name: "RTI", //Return from Interrupt
    bytes: 1,
    cycles: 6,
    execute: function() {
        //Pull processor flags from stack
        let sByte = this.pullStack();
        //Adjust mask and check each indv bit for each flag
        let mask = 1;
        this.flags.carry = ((sByte & mask) != 0);
        mask = 1 << 1;
        this.flags.zero = ((sByte & mask) != 0);
        mask = 1 << 2;
        this.flags.interruptDisable = ((sByte & mask) != 0);
        mask = 1 << 3;
        this.flags.decimalMode = ((sByte & mask) != 0);
        mask = 1 << 6;
        this.flags.overflow = ((sByte & mask) != 0);
        mask = 1 << 7;
        this.flags.negative = ((sByte & mask) != 0);
        //Pull PC from stack
        let loByte = this.pullStack();
        let hiByte = this.pullStack();
        let addr = combineHex(hiByte, loByte);
        if (this.debug) {
            console.log(`Return to location 0x${
                addr.toString(16).padStart(4, "0").toUpperCase()
                } from interrupt...`);
        }
        this.PC = addr-1;
    }
}


//UNOFFICIAL OPCODES
opTable[0xEB] = { //Seems to be identical to SBC (imm)
    name: "SBC (imm, unoffical)",
    bytes: 2,
    cycles: 2,
    execute: function() {
        SBC.call(this, this.nextByte());
    }
}
//NOP
opTable[0x1A] = {
    name: "NOP", //No operation, skip 2 bytes
    bytes: 1,
    cycles: 2,
    execute: function() { }
}
opTable[0x3A] = {
    name: "NOP", //No operation, skip 2 bytes
    bytes: 1,
    cycles: 2,
    execute: function() { }
}
opTable[0x5A] = {
    name: "NOP", //No operation, skip 2 bytes
    bytes: 1,
    cycles: 2,
    execute: function() { }
}
opTable[0x7A] = {
    name: "NOP", //No operation, skip 2 bytes
    bytes: 1,
    cycles: 2,
    execute: function() { }
}
opTable[0xDA] = {
    name: "NOP", //No operation, skip 2 bytes
    bytes: 1,
    cycles: 2,
    execute: function() { }
}
opTable[0xFA] = {
    name: "NOP", //No operation, skip 2 bytes
    bytes: 1,
    cycles: 2,
    execute: function() { }
}
opTable[0x04] = {
    name: "DOP", //No operation, skip 2 bytes
    bytes: 2,
    cycles: 3,
    execute: function() { }
}
opTable[0x14] = {
    name: "DOP",
    bytes: 2,
    cycles: 4,
    execute: function() { }
}
opTable[0x34] = {
    name: "DOP",
    bytes: 2,
    cycles: 4,
    execute: function() { }
}
opTable[0x44] = {
    name: "DOP",
    bytes: 2,
    cycles: 3,
    execute: function() { }
}
opTable[0x54] = {
    name: "DOP",
    bytes: 2,
    cycles: 4,
    execute: function() { }
}
opTable[0x64] = {
    name: "DOP",
    bytes: 2,
    cycles: 3,
    execute: function() { }
}
opTable[0x74] = {
    name: "DOP",
    bytes: 2,
    cycles: 4,
    execute: function() { }
}
opTable[0x80] = {
    name: "DOP",
    bytes: 2,
    cycles: 2,
    execute: function() { }
}
opTable[0x82] = {
    name: "DOP",
    bytes: 2,
    cycles: 2,
    execute: function() { }
}
opTable[0x89] = {
    name: "DOP",
    bytes: 2,
    cycles: 2,
    execute: function() { }
}
opTable[0xC2] = {
    name: "DOP",
    bytes: 2,
    cycles: 2,
    execute: function() { }
}
opTable[0xD4] = {
    name: "DOP",
    bytes: 2,
    cycles: 4,
    execute: function() { }
}
opTable[0xE2] = {
    name: "DOP",
    bytes: 2,
    cycles: 2,
    execute: function() { }
}
opTable[0xF4] = {
    name: "DOP",
    bytes: 2,
    cycles: 4,
    execute: function() { }
}

opTable[0x0C] = {
    name: "TOP", //No operation, skip 3 bytes
    bytes: 3,
    cycles: 4,
    execute: function() { }
}
opTable[0x1C] = {
    name: "TOP", //No operation, skip 3 bytes
    bytes: 3,
    cycles: 1,
    execute: function() { }
}
opTable[0x3C] = {
    name: "TOP", //No operation, skip 3 bytes
    bytes: 3,
    cycles: 4,
    execute: function() { }
}
opTable[0x5C] = {
    name: "TOP", //No operation, skip 3 bytes
    bytes: 3,
    cycles: 4,
    execute: function() { }
}
opTable[0x7C] = {
    name: "TOP", //No operation, skip 3 bytes
    bytes: 3,
    cycles: 4,
    execute: function() { }
}
opTable[0xDC] = {
    name: "TOP", //No operation, skip 3 bytes
    bytes: 3,
    cycles: 4,
    execute: function() { }
}
opTable[0xFC] = {
    name: "TOP", //No operation, skip 3 bytes
    bytes: 3,
    cycles: 4,
    execute: function() { }
}

//LAX
opTable[0xA3] = {
    name: "LAX (ind, X)", //Load ACC with X and memory
    bytes: 2,
    cycles: 6,
    execute: function() {
        let addr = this.getIndrXRef();
        this.ACC = this.X + this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0xB3] = {
    name: "LAX (ind), Y", //Load ACC with X and memory
    bytes: 2,
    cycles: 5,
    execute: function() {
        let addr = this.getIndrYRef();
        this.ACC = this.X + this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0xA7] = {
    name: "LAX (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function() {
        let addr = this.getZPageRef();
        this.ACC = this.X + this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0xB7] = {
    name: "LAX (zpg, Y)",
    bytes: 2,
    cycles: 4,
    execute: function() {
        let addr = this.getZPageRef(this.Y);
        this.ACC = this.X + this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0xAF] = {
    name: "LAX (abs)",
    bytes: 3,
    cycles: 4,
    execute: function() {
        let addr = this.getRef();
        this.ACC = this.X + this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0xBF] = {
    name: "LAX (abs)",
    bytes: 3,
    cycles: 4,
    execute: function() {
        let addr = this.getRef(this.Y);
        this.ACC = this.X + this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
}

//AND X with ACC and store result in memory
opTable[0x87] = {
    name: "AAX (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function() {
        let addr = this.getZPageRef();
        this.mem[addr] = this.ACC & this.X;
        this.updateNumStateFlags(this.mem[addr]);
    }
}
opTable[0x97] = {
    name: "AAX (zpg, Y)",
    bytes: 2,
    cycles: 4,
    execute: function() {
        let addr = this.getZPageRef(this.Y);
        this.mem[addr] = this.ACC & this.X;
        this.updateNumStateFlags(this.mem[addr]);
    }
}
opTable[0x83] = {
    name: "AAX (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function() {
        let addr = this.getIndrXRef();
        this.mem[addr] = this.ACC & this.X;
        this.updateNumStateFlags(this.mem[addr]);
    }
}
opTable[0x8F] = {
    name: "AAX (abs)",
    bytes: 3,
    cycles: 4,
    execute: function() {
        let addr = this.getRef();
        this.mem[addr] = this.ACC & this.X;
        this.updateNumStateFlags(this.mem[addr]);
    }
}

//DCP
//Subtract 1 from memory content, then CMP with ACC
opTable[0xC7] = {
    name: "DCP (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function() {
        let addr = this.getZPageRef();
        this.mem[addr]--;
        CMP.call(this, this.mem[addr], this.ACC);
    }
}
opTable[0xD7] = {
    name: "DCP (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function() {
        let addr = this.getZPageRef(this.X);
        this.mem[addr]--;
        CMP.call(this, this.mem[addr], this.ACC);
    }
}
opTable[0xCF] = {
    name: "DCP (abs)",
    bytes: 3,
    cycles: 6,
    execute: function() {
        let addr = this.getRef();
        this.mem[addr]--;
        CMP.call(this, this.mem[addr], this.ACC);
    }
}
opTable[0xDF] = {
    name: "DCP (zpg, X)",
    bytes: 3,
    cycles: 7,
    execute: function() {
        let addr = this.getRef(this.X);
        this.mem[addr]--;
        CMP.call(this, this.mem[addr], this.ACC);
    }
}
opTable[0xDB] = {
    name: "DCP (zpg, Y)",
    bytes: 3,
    cycles: 7,
    execute: function() {
        let addr = this.getRef(this.Y);
        this.mem[addr]--;
        CMP.call(this, this.mem[addr], this.ACC);
    }
}
opTable[0xC3] = {
    name: "DCP (ind, X)",
    bytes: 2,
    cycles: 8,
    execute: function() {
        let addr = this.getIndrXRef();
        this.mem[addr]--;
        CMP.call(this, this.mem[addr], this.ACC);
    }
}
opTable[0xD3] = {
    name: "DCP (ind), Y",
    bytes: 2,
    cycles: 8,
    execute: function() {
        let addr = this.getIndrYRef();
        this.mem[addr]--;
        CMP.call(this, this.mem[addr], this.ACC);
    }
}

//ISC
//Increase memory content by 1, then SBC from the ACC
opTable[0xE7] = {
    name: "ISC (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function() {
        let addr = this.getZPageRef();
        this.mem[addr]++;
        SBC.call(this, this.mem[addr]);
    }
}
opTable[0xF7] = {
    name: "ISC (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function() {
        let addr = this.getZPageRef(this.X);
        this.mem[addr]++;
        SBC.call(this, this.mem[addr]);
    }
}
opTable[0xEF] = {
    name: "ISC (abs)",
    bytes: 3,
    cycles: 6,
    execute: function() {
        let addr = this.getRef();
        this.mem[addr]++;
        SBC.call(this, this.mem[addr]);
    }
}
opTable[0xFF] = {
    name: "ISC (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function() {
        let addr = this.getRef(this.X);
        this.mem[addr]++;
        SBC.call(this, this.mem[addr]);
    }
}
opTable[0xFB] = {
    name: "ISC (abs, Y)",
    bytes: 3,
    cycles: 7,
    execute: function() {
        let addr = this.getRef(this.Y);
        this.mem[addr]++;
        SBC.call(this, this.mem[addr]);
    }
}
opTable[0xE3] = {
    name: "ISC (ind, X)",
    bytes: 2,
    cycles: 8,
    execute: function() {
        let addr = this.getIndrXRef();
        this.mem[addr]++;
        SBC.call(this, this.mem[addr]);
    }
}
opTable[0xF3] = {
    name: "ISC (abs)",
    bytes: 2,
    cycles: 8,
    execute: function() {
        let addr = this.getIndrYRef();
        this.mem[addr]++;
        SBC.call(this, this.mem[addr]);
    }
}

//SLO
//Shift memory content 1 bit left, then OR with ACC
opTable[0x07] = {
    name: "SLO (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function() {
        let addr = this.getZPageRef();
        this.flags.carry = (this.mem[addr] >= 0x80);
        this.mem[addr] = this.mem[addr] << 1;
        this.mem[addr] -= (this.flags.carry) ? 0x100 : 0;
        this.ACC = this.ACC | this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0x17] = {
    name: "SLO (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function() {
        let addr = this.getZPageRef(this.X);
        this.flags.carry = (this.mem[addr] >= 0x80);
        this.mem[addr] = this.mem[addr] << 1;
        this.mem[addr] -= (this.flags.carry) ? 0x100 : 0;
        this.ACC = this.ACC | this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0x0F] = {
    name: "SLO (abs)",
    bytes: 3,
    cycles: 6,
    execute: function() {
        let addr = this.getZPageRef();
        this.flags.carry = (this.mem[addr] >= 0x80);
        this.mem[addr] = this.mem[addr] << 1;
        this.mem[addr] -= (this.flags.carry) ? 0x100 : 0;
        this.ACC = this.ACC | this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0x1F] = {
    name: "SLO (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function() {
        let addr = this.getRef(this.X);
        this.flags.carry = (this.mem[addr] >= 0x80);
        this.mem[addr] = this.mem[addr] << 1;
        this.mem[addr] -= (this.flags.carry) ? 0x100 : 0;
        this.ACC = this.ACC | this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0x1B] = {
    name: "SLO (abs, Y)",
    bytes: 3,
    cycles: 7,
    execute: function() {
        let addr = this.getRef(this.Y);
        this.flags.carry = (this.mem[addr] >= 0x80);
        this.mem[addr] = this.mem[addr] << 1;
        this.mem[addr] -= (this.flags.carry) ? 0x100 : 0;
        this.ACC = this.ACC | this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0x03] = {
    name: "SLO (ind, Y)",
    bytes: 2,
    cycles: 8,
    execute: function() {
        let addr = this.getIndrXRef();
        this.flags.carry = (this.mem[addr] >= 0x80);
        this.mem[addr] = this.mem[addr] << 1;
        this.mem[addr] -= (this.flags.carry) ? 0x100 : 0;
        this.ACC = this.ACC | this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
}
opTable[0x13] = {
    name: "SLO (ind), Y",
    bytes: 2,
    cycles: 8,
    execute: function() {
        let addr = this.getIndrYRef();
        this.flags.carry = (this.mem[addr] >= 0x80);
        this.mem[addr] = this.mem[addr] << 1;
        this.mem[addr] -= (this.flags.carry) ? 0x100 : 0;
        this.ACC = this.ACC | this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
}
