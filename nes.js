class CPU {
    constructor(nes) {
        this.debug = false; //Output debug info
        //Stop execution when an infinite loop is detected
        this.detectTraps = false;
        this.RES_VECT_LOC = 0xFFFC;
        this.INT_VECT_LOC = 0xFFFE;
        this.NMI_VECT_LOC = 0xFFFA;
        this.IRQ = false; //Interrupt Request signal line
        this.NMI = false; //Non-Maskable Interrupt signal line
        this.cycleCount = 0;
        this.PC = 0; //Program Counter
        this.flags = {
            carry: false,
            zero: false,
            interruptDisable: true,
            decimalMode: false,
            break: false,
            overflow: false,
            negative: false //Result of last op had bit 7 set to 1
        };
        this.nes = nes;
    }
    boot() {
        this.flags.interruptDisable = true;
        this.ACC = 0;
        this.X = 0;
        this.Y = 0;
        this.SP = 0xFD;
        this.nes.write(0x4015, 0);
        this.nes.write(0x4017, 0);
        for (let i = 0; i < 0x10; i++) {
            this.nes.write(0x4000 + i, 0);
        }
        this.PC = this.getResetVector();
    }
    reset() {
        this.SP -= 3;
        this.flags.interruptDisable = true;
        this.nes.write(0x4015, 0);
        this.PC = this.getResetVector();
    }
    step() {
        //Check interrupt lines
        if (this.NMI) {
            this.NMI = false;
            this.handleInterrupt(this.NMI_VECT_LOC);
        }
        else if (this.IRQ && !this.flags.interruptDisable) {
            this.IRQ = false;
            this.handleInterrupt(this.INT_VECT_LOC);
        }
        let opCode = this.nes.read(this.PC); //Fetch
        let op = opTable[opCode]; //Decode
        //console.log(op.name, "at", this.PC.toString(16));
        if (op === undefined) {
            let e = new Error(`Encountered unknown opCode: [0x${opCode.toString(16).toUpperCase()}] at PC: 0x${this.PC.toString(16).padStart(4, "0").toUpperCase()}`);
            e.name = "Unexpected OpCode";
            throw e;
        }
        if (this.debug) {
            console.log(`Executing ${op.name} at 0x${this.PC.toString(16).padStart(4, "0").toUpperCase()}...`);
        }
        op.execute.bind(this)(); //Execute
        if (this.debug) {
            this.displayState();
            console.log("");
        }
        this.PC += op.bytes;
        if (this.PC > 0xFFFF) {
            this.PC -= 0x10000;
        }
        this.cycleCount += op.cycles;
        return op.cycles;
    }
    requestInterrupt() {
        this.IRQ = true;
    }
    requestNMInterrupt() {
        this.NMI = true;
    }
    handleInterrupt(resetVectStartAddr, setBRK = false) {
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
        this.PC = combineHex(this.nes.read(resetVectStartAddr + 1), this.nes.read(resetVectStartAddr));
    }
    getResetVector() {
        return combineHex(this.nes.read(this.RES_VECT_LOC + 1), this.nes.read(this.RES_VECT_LOC));
    }
    pushStack(byte) {
        //Write byte to stack
        this.nes.write(combineHex(0x01, this.SP), byte);
        //Decrement stack pointer, wrap if necessary
        this.SP--;
        if (this.SP < 0) {
            this.SP = 0xFF;
        }
    }
    pullStack() {
        this.SP++;
        if (this.SP > 0xFF) {
            this.SP = 0;
        }
        let byte = this.nes.read(combineHex(0x01, this.SP));
        return byte;
    }
    displayState() {
        //Print Registers
        console.log(`[ACC: 0x${this.ACC.toString(16).padStart(2, "0").toUpperCase()} X: 0x${this.X.toString(16).padStart(2, "0").toUpperCase()} Y: 0x${this.Y.toString(16).padStart(2, "0").toUpperCase()} PC: 0x${this.PC.toString(16).padStart(4, "0").toUpperCase()} SP: 0x${this.SP.toString(16).padStart(2, "0").toUpperCase()} ]`);
        //Print flags
        let keys = Object.getOwnPropertyNames(this.flags);
        for (let key of keys) {
            console.log(`${key}: ${this.flags[key]}`);
        }
    }
    nextByte() {
        return this.nes.read(this.PC + 1);
    }
    next2Bytes(flip = true) {
        if (flip) {
            return combineHex(this.nes.read(this.PC + 2), this.nes.read(this.PC + 1));
        }
        else {
            return combineHex(this.nes.read(this.PC + 1), this.nes.read(this.PC + 2));
        }
    }
    updateOverflowFlag(reg, num1, num2) {
        //If the sum of two like signed terms is a diff sign, then the
        //signed result is outside [-128, 127], so set overflow flag
        this.flags.overflow = (num1 < 0x80 && num2 < 0x80 && reg >= 0x80) ||
            (num1 >= 0x80 && num2 >= 0x80 && reg < 0x80);
    }
    updateNegativeFlag(register) {
        this.flags.negative = (register > 0x7F);
    }
    updateNumStateFlags(register) {
        this.flags.zero = (register === 0x00);
        this.updateNegativeFlag(register);
    }
    getRef(offset = 0) {
        let addr = this.next2Bytes() + offset;
        if (addr > 0xFFFF) {
            addr -= 0x10000;
        }
        if (this.debug) {
            console.log(`Accessing memory at 0x${addr.toString(16).padStart(4, "0").toUpperCase()}...`);
        }
        return addr;
    }
    getZPageRef(offset = 0) {
        let addr = this.nextByte() + offset;
        addr -= (addr > 0xFF) ? 0x100 : 0;
        if (this.debug) {
            console.log(`Accessing memory at 0x${addr.toString(16).padStart(4, "0").toUpperCase()}...`);
        }
        return addr;
    }
    getIndrXRef() {
        let addr = this.getZPageRef(this.X);
        if (addr == 0xFF) {
            return combineHex(this.nes.read(0), this.nes.read(addr));
        }
        else {
            return combineHex(this.nes.read(addr + 1), this.nes.read(addr));
        }
    }
    getIndrYRef() {
        let addr = this.getZPageRef();
        let res;
        if (addr == 0xFF) {
            res = combineHex(this.nes.read(0), this.nes.read(addr)) + this.Y;
        }
        else {
            res = combineHex(this.nes.read(addr + 1), this.nes.read(addr)) + this.Y;
        }
        if (res > 0xFFFF) {
            res -= 0x10000;
        }
        return res;
    }
}
let opTable = {};
opTable[0x00] = {
    name: "BRK",
    bytes: 0,
    cycles: 7,
    execute: function () {
        this.PC += 2;
        this.handleInterrupt(this.INT_VECT_LOC, true);
    }
};
opTable[0xA9] = {
    name: "LDA (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        this.ACC = this.nextByte();
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0xAD] = {
    name: "LDA (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef();
        this.ACC = this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0xBD] = {
    name: "LDA (abs, X)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef(this.X);
        this.ACC = this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0xB9] = {
    name: "LDA (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef(this.Y);
        this.ACC = this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0xA5] = {
    name: "LDA (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        let addr = this.getZPageRef();
        this.ACC = this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0xB5] = {
    name: "LDA (zpg, X)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        this.ACC = this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0xA1] = {
    name: "LDA (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getIndrXRef();
        this.ACC = this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0xB1] = {
    name: "LDA (ind), Y",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getIndrYRef();
        this.ACC = this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0xA2] = {
    name: "LDX (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        this.X = this.nextByte();
        this.updateNumStateFlags(this.X);
    }
};
opTable[0xA6] = {
    name: "LDX (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        let addr = this.getZPageRef();
        this.X = this.nes.read(addr);
        this.updateNumStateFlags(this.X);
    }
};
opTable[0xB6] = {
    name: "LDX (zpg, Y)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        let addr = this.getZPageRef(this.Y);
        this.X = this.nes.read(addr);
        this.updateNumStateFlags(this.X);
    }
};
opTable[0xAE] = {
    name: "LDX (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef();
        this.X = this.nes.read(addr);
        this.updateNumStateFlags(this.X);
    }
};
opTable[0xBE] = {
    name: "LDX (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef(this.Y);
        this.X = this.nes.read(addr);
        this.updateNumStateFlags(this.X);
    }
};
opTable[0xA0] = {
    name: "LDY (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        this.Y = this.nextByte();
        this.updateNumStateFlags(this.Y);
    }
};
opTable[0xA4] = {
    name: "LDY (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        let addr = this.getZPageRef();
        this.Y = this.nes.read(addr);
        this.updateNumStateFlags(this.Y);
    }
};
opTable[0xB4] = {
    name: "LDY (zpg, X)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        this.Y = this.nes.read(addr);
        this.updateNumStateFlags(this.Y);
    }
};
opTable[0xAC] = {
    name: "LDY (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef();
        this.Y = this.nes.read(addr);
        this.updateNumStateFlags(this.Y);
    }
};
opTable[0xBC] = {
    name: "LDY (abs, X)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef(this.X);
        this.Y = this.nes.read(addr);
        this.updateNumStateFlags(this.Y);
    }
};
opTable[0x85] = {
    name: "STA (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        let addr = this.getZPageRef();
        this.nes.write(addr, this.ACC);
    }
};
opTable[0x95] = {
    name: "STA (zpg, X)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        this.nes.write(addr, this.ACC);
    }
};
opTable[0x8D] = {
    name: "STA (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef();
        this.nes.write(addr, this.ACC);
    }
};
opTable[0x9D] = {
    name: "STA (abs, X)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef(this.X);
        this.nes.write(addr, this.ACC);
    }
};
opTable[0x99] = {
    name: "STA (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef(this.Y);
        this.nes.write(addr, this.ACC);
    }
};
opTable[0x81] = {
    name: "STA (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getIndrXRef();
        this.nes.write(addr, this.ACC);
    }
};
opTable[0x91] = {
    name: "STA (ind), Y",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getIndrYRef();
        this.nes.write(addr, this.ACC);
    }
};
opTable[0x86] = {
    name: "STX (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        let addr = this.getZPageRef();
        this.nes.write(addr, this.X);
    }
};
opTable[0x96] = {
    name: "STX (zpg, Y)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        let addr = this.getZPageRef(this.Y);
        this.nes.write(addr, this.X);
    }
};
opTable[0x8E] = {
    name: "STX (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef();
        this.nes.write(addr, this.X);
    }
};
opTable[0x84] = {
    name: "STY (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        let addr = this.getZPageRef();
        this.nes.write(addr, this.Y);
    }
};
opTable[0x94] = {
    name: "STY (zpg, Y)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        this.nes.write(addr, this.Y);
    }
};
opTable[0x8C] = {
    name: "STY (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef();
        this.nes.write(addr, this.Y);
    }
};
opTable[0xAA] = {
    name: "TAX",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.X = this.ACC;
        this.updateNumStateFlags(this.X);
    }
};
opTable[0xA8] = {
    name: "TAY",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.Y = this.ACC;
        this.updateNumStateFlags(this.Y);
    }
};
opTable[0xBA] = {
    name: "TSX",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.X = this.SP;
        this.updateNumStateFlags(this.X);
    }
};
opTable[0x8A] = {
    name: "TXA",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.ACC = this.X;
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x9A] = {
    name: "TXS",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.SP = this.X;
    }
};
opTable[0x98] = {
    name: "TYA",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.ACC = this.Y;
        this.updateNumStateFlags(this.Y);
    }
};
function ADC(num) {
    let num2 = this.ACC;
    this.ACC += num + this.flags.carry;
    //Wrap ACC and set/clear carry flag
    if (this.ACC > 0xFF) {
        this.flags.carry = true;
        this.ACC -= 0x100;
    }
    else {
        this.flags.carry = false;
    }
    ///Set/clear overflow flag
    this.updateOverflowFlag(this.ACC, num, num2);
    //Set/clear negative + zero flags
    this.updateNumStateFlags(this.ACC);
}
opTable[0x69] = {
    name: "ADC (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        ADC.call(this, this.nextByte());
    }
};
opTable[0x65] = {
    name: "ADC (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        let addr = this.getZPageRef();
        ADC.call(this, this.nes.read(addr));
    }
};
opTable[0x75] = {
    name: "ADC (zpg, X)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        ADC.call(this, this.nes.read(addr));
    }
};
opTable[0x6D] = {
    name: "ADC (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef();
        ADC.call(this, this.nes.read(addr));
    }
};
opTable[0x7D] = {
    name: "ADC (abs, X)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef(this.X);
        ADC.call(this, this.nes.read(addr));
    }
};
opTable[0x79] = {
    name: "ADC (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef(this.Y);
        ADC.call(this, this.nes.read(addr));
    }
};
opTable[0x61] = {
    name: "ADC (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getIndrXRef();
        ADC.call(this, this.nes.read(addr));
    }
};
opTable[0x71] = {
    name: "ADC (ind), Y",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getIndrYRef();
        ADC.call(this, this.nes.read(addr));
    }
};
function SBC(num) {
    if (this.flags.decimalMode) {
        //Convert current 2 digit hex to literal 2 digit decimal
        let num2 = parseInt(this.ACC.toString(16));
        num = parseInt(num.toString(16));
        let res = num2 - num;
        res -= (this.flags.carry) ? 0 : 1;
        if (res < 0) {
            this.flags.carry = false;
            res += 100;
        }
        else {
            this.flags.carry = true;
        }
        this.ACC = parseInt(res.toString(), 16);
    }
    else {
        let mask = 0xFF;
        let flipBits = num ^ mask;
        ADC.call(this, flipBits);
    }
}
opTable[0xE9] = {
    name: "SBC (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        SBC.call(this, this.nextByte());
    }
};
opTable[0xE5] = {
    name: "SBC (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        let num = this.nes.read(this.getZPageRef());
        SBC.call(this, num);
    }
};
opTable[0xF5] = {
    name: "SBC (zpg, X)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        let num = this.nes.read(this.getZPageRef(this.X));
        SBC.call(this, num);
    }
};
opTable[0xED] = {
    name: "SBC (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let num = this.nes.read(this.getRef());
        SBC.call(this, num);
    }
};
opTable[0xFD] = {
    name: "SBC (abs, X)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let num = this.nes.read(this.getRef(this.X));
        SBC.call(this, num);
    }
};
opTable[0xF9] = {
    name: "SBC (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let num = this.nes.read(this.getRef(this.Y));
        SBC.call(this, num);
    }
};
opTable[0xE1] = {
    name: "SBC (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let num = this.nes.read(this.getIndrXRef());
        SBC.call(this, num);
    }
};
opTable[0xF1] = {
    name: "SBC (ind), Y",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let num = this.nes.read(this.getIndrYRef());
        SBC.call(this, num);
    }
};
opTable[0xEA] = {
    name: "NOP",
    bytes: 1,
    cycles: 1,
    execute: function () { }
};
opTable[0xE6] = {
    name: "INC (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getZPageRef();
        this.nes.write(addr, addWrap(this.nes.read(addr), 1));
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0xF6] = {
    name: "INC (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        this.nes.write(addr, addWrap(this.nes.read(addr), 1));
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0xEE] = {
    name: "INC (abs)",
    bytes: 3,
    cycles: 6,
    execute: function () {
        let addr = this.getRef();
        this.nes.write(addr, addWrap(this.nes.read(addr), 1));
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0xFE] = {
    name: "INC (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.X);
        this.nes.write(addr, addWrap(this.nes.read(addr), 1));
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0xE8] = {
    name: "INX",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.X = addWrap(this.X, 1);
        this.updateNumStateFlags(this.X);
    }
};
opTable[0xC8] = {
    name: "INY",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.Y = addWrap(this.Y, 1);
        this.updateNumStateFlags(this.Y);
    }
};
opTable[0xC6] = {
    name: "DEC (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getZPageRef();
        this.nes.write(addr, addWrap(this.nes.read(addr), -1));
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0xD6] = {
    name: "DEC (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        this.nes.write(addr, addWrap(this.nes.read(addr), -1));
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0xCE] = {
    name: "DEC (abs)",
    bytes: 3,
    cycles: 3,
    execute: function () {
        let addr = this.getRef();
        this.nes.write(addr, addWrap(this.nes.read(addr), -1));
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0xDE] = {
    name: "DEC (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.X);
        this.nes.write(addr, addWrap(this.nes.read(addr), -1));
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0xCA] = {
    name: "DEX",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.X = addWrap(this.X, -1);
        this.updateNumStateFlags(this.X);
    }
};
opTable[0x88] = {
    name: "DEY",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.Y = addWrap(this.Y, -1);
        this.updateNumStateFlags(this.Y);
    }
};
opTable[0x18] = {
    name: "CLC",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.flags.carry = false;
    }
};
opTable[0xD8] = {
    name: "CLD",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.flags.decimalMode = false;
    }
};
opTable[0xB8] = {
    name: "CLV",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.flags.overflow = false;
    }
};
opTable[0x58] = {
    name: "CLI",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.flags.interruptDisable = false;
    }
};
opTable[0x38] = {
    name: "SEC",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.flags.carry = true;
    }
};
opTable[0xF8] = {
    name: "SED",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.flags.decimalMode = true;
    }
};
opTable[0x78] = {
    name: "SEI",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.flags.interruptDisable = true;
    }
};
function CMP(num, register) {
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
    execute: function () {
        CMP.call(this, this.nextByte(), this.ACC);
    }
};
opTable[0xC5] = {
    name: "CMP (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        CMP.call(this, this.nes.read(this.getZPageRef()), this.ACC);
    }
};
opTable[0xD5] = {
    name: "CMP (zpg, X)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        CMP.call(this, this.nes.read(this.getZPageRef(this.X)), this.ACC);
    }
};
opTable[0xCD] = {
    name: "CMP (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        CMP.call(this, this.nes.read(this.getRef()), this.ACC);
    }
};
opTable[0xDD] = {
    name: "CMP (abs, X)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        CMP.call(this, this.nes.read(this.getRef(this.X)), this.ACC);
    }
};
opTable[0xD9] = {
    name: "CMP (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        CMP.call(this, this.nes.read(this.getRef(this.Y)), this.ACC);
    }
};
opTable[0xC1] = {
    name: "CMP (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        CMP.call(this, this.nes.read(this.getIndrXRef()), this.ACC);
    }
};
opTable[0xD1] = {
    name: "CMP (ind), Y",
    bytes: 2,
    cycles: 5,
    execute: function () {
        CMP.call(this, this.nes.read(this.getIndrYRef()), this.ACC);
    }
};
opTable[0xE0] = {
    name: "CPX (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        CMP.call(this, this.nextByte(), this.X);
    }
};
opTable[0xE4] = {
    name: "CPX (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        CMP.call(this, this.nes.read(this.getZPageRef()), this.X);
    }
};
opTable[0xEC] = {
    name: "CPX (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        CMP.call(this, this.nes.read(this.getRef()), this.X);
    }
};
opTable[0xC0] = {
    name: "CPY (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        CMP.call(this, this.nextByte(), this.Y);
    }
};
opTable[0xC4] = {
    name: "CPY (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        CMP.call(this, this.nes.read(this.getZPageRef()), this.Y);
    }
};
opTable[0xCC] = {
    name: "CPY (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        CMP.call(this, this.nes.read(this.getRef()), this.Y);
    }
};
opTable[0x29] = {
    name: "AND (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        this.ACC = this.ACC & this.nextByte();
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x25] = {
    name: "AND (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        this.ACC = this.ACC & this.nes.read(this.getZPageRef());
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x35] = {
    name: "AND (zpg, X)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        this.ACC = this.ACC & this.nes.read(this.getZPageRef(this.X));
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x2D] = {
    name: "AND (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        this.ACC = this.ACC & this.nes.read(this.getRef());
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x3D] = {
    name: "AND (abs, X)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        this.ACC = this.ACC & this.nes.read(this.getRef(this.X));
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x39] = {
    name: "AND (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        this.ACC = this.ACC & this.nes.read(this.getRef(this.Y));
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x21] = {
    name: "AND (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        this.ACC = this.ACC & this.nes.read(this.getIndrXRef());
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x31] = {
    name: "AND (ind), Y",
    bytes: 2,
    cycles: 5,
    execute: function () {
        this.ACC = this.ACC & this.nes.read(this.getIndrYRef());
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x09] = {
    name: "ORA (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        this.ACC = this.ACC | this.nextByte();
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x05] = {
    name: "ORA (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        this.ACC = this.ACC | this.nes.read(this.getZPageRef());
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x15] = {
    name: "ORA (zpg, X)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        this.ACC = this.ACC | this.nes.read(this.getZPageRef(this.X));
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x0D] = {
    name: "ORA (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        this.ACC = this.ACC | this.nes.read(this.getRef());
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x1D] = {
    name: "ORA (abs, X)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        this.ACC = this.ACC | this.nes.read(this.getRef(this.X));
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x19] = {
    name: "ORA (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        this.ACC = this.ACC | this.nes.read(this.getRef(this.Y));
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x01] = {
    name: "ORA (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        this.ACC = this.ACC | this.nes.read(this.getIndrXRef());
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x11] = {
    name: "ORA (ind), Y",
    bytes: 2,
    cycles: 5,
    execute: function () {
        this.ACC = this.ACC | this.nes.read(this.getIndrYRef());
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x49] = {
    name: "EOR (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        this.ACC = this.ACC ^ this.nextByte();
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x45] = {
    name: "EOR (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        this.ACC = this.ACC ^ this.nes.read(this.getZPageRef());
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x55] = {
    name: "EOR (zpg, X)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        this.ACC = this.ACC ^ this.nes.read(this.getZPageRef(this.X));
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x4D] = {
    name: "EOR (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        this.ACC = this.ACC ^ this.nes.read(this.getRef());
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x5D] = {
    name: "EOR (abs, X)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        this.ACC = this.ACC ^ this.nes.read(this.getRef(this.X));
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x59] = {
    name: "EOR (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        this.ACC = this.ACC ^ this.nes.read(this.getRef(this.Y));
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x41] = {
    name: "EOR (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        this.ACC = this.ACC ^ this.nes.read(this.getIndrXRef());
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x51] = {
    name: "EOR (ind), Y",
    bytes: 2,
    cycles: 5,
    execute: function () {
        this.ACC = this.ACC ^ this.nes.read(this.getIndrYRef());
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x0A] = {
    name: "ASL",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.flags.carry = (this.ACC >= 0x80);
        this.ACC = this.ACC << 1;
        this.ACC -= (this.flags.carry) ? 0x100 : 0;
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x06] = {
    name: "ASL (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getZPageRef();
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0x16] = {
    name: "ASL (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0x0E] = {
    name: "ASL (abs)",
    bytes: 3,
    cycles: 6,
    execute: function () {
        let addr = this.getRef();
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0x1E] = {
    name: "ASL (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.X);
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0x4A] = {
    name: "LSR",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.flags.carry = (this.ACC % 2 == 1);
        this.ACC = this.ACC >> 1;
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x46] = {
    name: "LSR (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getZPageRef();
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0x56] = {
    name: "LSR (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0x4E] = {
    name: "LSR (abs)",
    bytes: 3,
    cycles: 6,
    execute: function () {
        let addr = this.getRef();
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0x5E] = {
    name: "LSR (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.X);
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0x24] = {
    name: "BIT (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        let addr = this.getZPageRef();
        let res = this.ACC & this.nes.read(addr);
        this.flags.zero = (res == 0x00);
        this.updateNegativeFlag(this.nes.read(addr));
        let mask = 1 << 6; //6th bit mask
        this.flags.overflow = ((this.nes.read(addr) & mask) != 0);
    }
};
opTable[0x2C] = {
    name: "BIT (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef();
        let res = this.ACC & this.nes.read(addr);
        this.flags.zero = (res == 0x00);
        this.updateNegativeFlag(this.nes.read(addr));
        let mask = 1 << 6; //6th bit mask
        this.flags.overflow = ((this.nes.read(addr) & mask) != 0);
    }
};
opTable[0x2A] = {
    name: "ROL",
    bytes: 1,
    cycles: 2,
    execute: function () {
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
};
opTable[0x26] = {
    name: "ROL (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getZPageRef();
        let addBit = this.flags.carry;
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.nes.write(addr, this.nes.read(addr) + addBit);
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0x36] = {
    name: "ROL (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        let addBit = this.flags.carry;
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.nes.write(addr, this.nes.read(addr) + addBit);
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0x2E] = {
    name: "ROL (abs)",
    bytes: 3,
    cycles: 6,
    execute: function () {
        let addr = this.getRef();
        let addBit = this.flags.carry;
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.nes.write(addr, this.nes.read(addr) + addBit);
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0x3E] = {
    name: "ROL (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.X);
        let addBit = this.flags.carry;
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.nes.write(addr, this.nes.read(addr) + addBit);
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0x6A] = {
    name: "ROR",
    bytes: 1,
    cycles: 2,
    execute: function () {
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
};
opTable[0x66] = {
    name: "ROR (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getZPageRef();
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.nes.write(addr, this.nes.read(addr) + addBit);
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0x76] = {
    name: "ROR (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.nes.write(addr, this.nes.read(addr) + addBit);
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0x6E] = {
    name: "ROR (abs)",
    bytes: 3,
    cycles: 6,
    execute: function () {
        let addr = this.getRef();
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.nes.write(addr, this.nes.read(addr) + addBit);
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0x7E] = {
    name: "ROR (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.X);
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.nes.write(addr, this.nes.read(addr) + addBit);
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
function branch() {
    let dist = this.nextByte();
    dist -= (dist < 0x80) ? 0 : 0x100;
    if (this.debug) {
        console.log(`Branching ${dist} bytes...`);
    }
    if (dist == -2 && this.detectTraps) {
        console.log(`TRAPPED at 0x${this.PC.toString(16).padStart(4, "0").toUpperCase()}`);
        this.flags.break = true;
    }
    this.PC += dist;
}
opTable[0x90] = {
    name: "BCC",
    bytes: 2,
    cycles: 2,
    execute: function () {
        if (!this.flags.carry) {
            branch.call(this);
        }
    }
};
opTable[0xB0] = {
    name: "BCS",
    bytes: 2,
    cycles: 2,
    execute: function () {
        if (this.flags.carry) {
            branch.call(this);
        }
    }
};
opTable[0x30] = {
    name: "BMI",
    bytes: 2,
    cycles: 2,
    execute: function () {
        if (this.flags.negative) {
            branch.call(this);
        }
    }
};
opTable[0x10] = {
    name: "BPL",
    bytes: 2,
    cycles: 2,
    execute: function () {
        if (!this.flags.negative) {
            branch.call(this);
        }
    }
};
opTable[0xF0] = {
    name: "BEQ",
    bytes: 2,
    cycles: 2,
    execute: function () {
        if (this.flags.zero) {
            branch.call(this);
        }
    }
};
opTable[0xD0] = {
    name: "BNE",
    bytes: 2,
    cycles: 2,
    execute: function () {
        if (!this.flags.zero) {
            branch.call(this);
        }
    }
};
opTable[0x50] = {
    name: "BVC",
    bytes: 2,
    cycles: 2,
    execute: function () {
        if (!this.flags.overflow) {
            branch.call(this);
        }
    }
};
opTable[0x70] = {
    name: "BVS",
    bytes: 2,
    cycles: 2,
    execute: function () {
        if (this.flags.overflow) {
            branch.call(this);
        }
    }
};
opTable[0x4C] = {
    name: "JMP (abs)",
    bytes: 3,
    cycles: 3,
    execute: function () {
        let addr = this.getRef();
        if (this.debug) {
            console.log(`Jumping to location 0x${addr.toString(16).padStart(4, "0")}...`);
        }
        if (addr == this.PC && this.detectTraps) {
            console.log(`TRAPPED at 0x${this.PC.toString(16).padStart(4, "0").toUpperCase()}`);
            this.flags.break = true;
        }
        this.PC = addr - 3;
    }
};
opTable[0x6C] = {
    name: "JMP (ind)",
    bytes: 3,
    cycles: 5,
    execute: function () {
        let indAddr = this.next2Bytes();
        let addr;
        if ((indAddr & 0xFF) == 0xFF) {
            addr = combineHex(this.nes.read(indAddr - 0xFF), this.nes.read(indAddr));
        }
        else {
            addr = combineHex(this.nes.read(indAddr + 1), this.nes.read(indAddr));
        }
        if (this.debug) {
            console.log(`Jumping to location 0x${addr}...`);
        }
        if (addr == this.PC && this.detectTraps) {
            console.log(`TRAPPED at 0x${this.PC.toString(16).padStart(4, "0").toUpperCase()}`);
            this.flags.break = true;
        }
        this.PC = addr - 3;
    }
};
opTable[0x20] = {
    name: "JSR",
    bytes: 3,
    cycles: 6,
    execute: function () {
        let addr = this.getRef();
        if (this.debug) {
            console.log(`Jumping to subroutine at 0x${addr.toString(16).padStart(4, "0").toUpperCase()}...`);
        }
        //Split PC and add each addr byte to stack
        let bytes = splitHex(this.PC + 2);
        this.pushStack(bytes[0]);
        this.pushStack(bytes[1]);
        this.PC = addr - 3;
    }
};
opTable[0x60] = {
    name: "RTS",
    bytes: 1,
    cycles: 6,
    execute: function () {
        let loByte = this.pullStack();
        let hiByte = this.pullStack();
        let addr = combineHex(hiByte, loByte);
        if (this.debug) {
            console.log(`Return to location 0x${addr.toString(16).padStart(4, "0").toUpperCase()} from subroutine...`);
        }
        this.PC = addr;
    }
};
opTable[0x48] = {
    name: "PHA",
    bytes: 1,
    cycles: 3,
    execute: function () {
        this.pushStack(this.ACC);
    }
};
opTable[0x08] = {
    name: "PHP",
    bytes: 1,
    cycles: 3,
    execute: function () {
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
};
opTable[0x68] = {
    name: "PLA",
    bytes: 1,
    cycles: 4,
    execute: function () {
        this.ACC = this.pullStack();
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x28] = {
    name: "PLP",
    bytes: 1,
    cycles: 4,
    execute: function () {
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
};
opTable[0x40] = {
    name: "RTI",
    bytes: 1,
    cycles: 6,
    execute: function () {
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
            console.log(`Return to location 0x${addr.toString(16).padStart(4, "0").toUpperCase()} from interrupt...`);
        }
        this.PC = addr - 1;
    }
};
//UNOFFICIAL OPCODES
opTable[0xEB] = {
    name: "SBC (imm, unoffical)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        SBC.call(this, this.nextByte());
    }
};
//NOP
opTable[0x1A] = {
    name: "NOP",
    bytes: 1,
    cycles: 2,
    execute: function () { }
};
opTable[0x3A] = {
    name: "NOP",
    bytes: 1,
    cycles: 2,
    execute: function () { }
};
opTable[0x5A] = {
    name: "NOP",
    bytes: 1,
    cycles: 2,
    execute: function () { }
};
opTable[0x7A] = {
    name: "NOP",
    bytes: 1,
    cycles: 2,
    execute: function () { }
};
opTable[0xDA] = {
    name: "NOP",
    bytes: 1,
    cycles: 2,
    execute: function () { }
};
opTable[0xFA] = {
    name: "NOP",
    bytes: 1,
    cycles: 2,
    execute: function () { }
};
opTable[0x04] = {
    name: "DOP",
    bytes: 2,
    cycles: 3,
    execute: function () { }
};
opTable[0x14] = {
    name: "DOP",
    bytes: 2,
    cycles: 4,
    execute: function () { }
};
opTable[0x34] = {
    name: "DOP",
    bytes: 2,
    cycles: 4,
    execute: function () { }
};
opTable[0x44] = {
    name: "DOP",
    bytes: 2,
    cycles: 3,
    execute: function () { }
};
opTable[0x54] = {
    name: "DOP",
    bytes: 2,
    cycles: 4,
    execute: function () { }
};
opTable[0x64] = {
    name: "DOP",
    bytes: 2,
    cycles: 3,
    execute: function () { }
};
opTable[0x74] = {
    name: "DOP",
    bytes: 2,
    cycles: 4,
    execute: function () { }
};
opTable[0x80] = {
    name: "DOP",
    bytes: 2,
    cycles: 2,
    execute: function () { }
};
opTable[0x82] = {
    name: "DOP",
    bytes: 2,
    cycles: 2,
    execute: function () { }
};
opTable[0x89] = {
    name: "DOP",
    bytes: 2,
    cycles: 2,
    execute: function () { }
};
opTable[0xC2] = {
    name: "DOP",
    bytes: 2,
    cycles: 2,
    execute: function () { }
};
opTable[0xD4] = {
    name: "DOP",
    bytes: 2,
    cycles: 4,
    execute: function () { }
};
opTable[0xE2] = {
    name: "DOP",
    bytes: 2,
    cycles: 2,
    execute: function () { }
};
opTable[0xF4] = {
    name: "DOP",
    bytes: 2,
    cycles: 4,
    execute: function () { }
};
opTable[0x0C] = {
    name: "TOP",
    bytes: 3,
    cycles: 4,
    execute: function () { }
};
opTable[0x1C] = {
    name: "TOP",
    bytes: 3,
    cycles: 1,
    execute: function () { }
};
opTable[0x3C] = {
    name: "TOP",
    bytes: 3,
    cycles: 4,
    execute: function () { }
};
opTable[0x5C] = {
    name: "TOP",
    bytes: 3,
    cycles: 4,
    execute: function () { }
};
opTable[0x7C] = {
    name: "TOP",
    bytes: 3,
    cycles: 4,
    execute: function () { }
};
opTable[0xDC] = {
    name: "TOP",
    bytes: 3,
    cycles: 4,
    execute: function () { }
};
opTable[0xFC] = {
    name: "TOP",
    bytes: 3,
    cycles: 4,
    execute: function () { }
};
//LAX, Load ACC and X with memory
opTable[0xA3] = {
    name: "LAX (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getIndrXRef();
        this.X = this.nes.read(addr);
        this.ACC = this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0xB3] = {
    name: "LAX (ind), Y",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getIndrYRef();
        this.X = this.nes.read(addr);
        this.ACC = this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0xA7] = {
    name: "LAX (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        let addr = this.getZPageRef();
        this.X = this.nes.read(addr);
        this.ACC = this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0xB7] = {
    name: "LAX (zpg, Y)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        let addr = this.getZPageRef(this.Y);
        this.X = this.nes.read(addr);
        this.ACC = this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0xAF] = {
    name: "LAX (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef();
        this.X = this.nes.read(addr);
        this.ACC = this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0xBF] = {
    name: "LAX (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef(this.Y);
        this.X = this.nes.read(addr);
        this.ACC = this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
//AND X with ACC and store result in memory
opTable[0x87] = {
    name: "SAX (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        let addr = this.getZPageRef();
        this.nes.write(addr, this.ACC & this.X);
    }
};
opTable[0x97] = {
    name: "SAX (zpg, Y)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        let addr = this.getZPageRef(this.Y);
        this.nes.write(addr, this.ACC & this.X);
    }
};
opTable[0x83] = {
    name: "SAX (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getIndrXRef();
        this.nes.write(addr, this.ACC & this.X);
    }
};
opTable[0x8F] = {
    name: "SAX (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef();
        this.nes.write(addr, this.ACC & this.X);
    }
};
//DCP
//Subtract 1 from memory content, then CMP with ACC
opTable[0xC7] = {
    name: "DCP (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getZPageRef();
        let num = this.nes.read(addr) - 1;
        if (num < 0)
            num = 0xFF;
        CMP.call(this, num, this.ACC);
    }
};
opTable[0xD7] = {
    name: "DCP (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        let num = this.nes.read(addr) - 1;
        if (num < 0)
            num = 0xFF;
        CMP.call(this, num, this.ACC);
    }
};
opTable[0xCF] = {
    name: "DCP (abs)",
    bytes: 3,
    cycles: 6,
    execute: function () {
        let addr = this.getRef();
        let num = this.nes.read(addr) - 1;
        if (num < 0)
            num = 0xFF;
        CMP.call(this, num, this.ACC);
    }
};
opTable[0xDF] = {
    name: "DCP (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.X);
        let num = this.nes.read(addr) - 1;
        if (num < 0)
            num = 0xFF;
        CMP.call(this, num, this.ACC);
    }
};
opTable[0xDB] = {
    name: "DCP (abs, Y)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.Y);
        let num = this.nes.read(addr) - 1;
        if (num < 0)
            num = 0xFF;
        CMP.call(this, num, this.ACC);
    }
};
opTable[0xC3] = {
    name: "DCP (ind, X)",
    bytes: 2,
    cycles: 8,
    execute: function () {
        let addr = this.getIndrXRef();
        let num = this.nes.read(addr) - 1;
        if (num < 0)
            num = 0xFF;
        CMP.call(this, num, this.ACC);
    }
};
opTable[0xD3] = {
    name: "DCP (ind), Y",
    bytes: 2,
    cycles: 8,
    execute: function () {
        let addr = this.getIndrYRef();
        let num = this.nes.read(addr) - 1;
        if (num < 0)
            num = 0xFF;
        CMP.call(this, num, this.ACC);
    }
};
//ISC
//Increase memory content by 1, then SBC from the ACC
opTable[0xE7] = {
    name: "ISC (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getZPageRef();
        this.nes.write(addr, this.nes.read(addr) + 1);
        SBC.call(this, this.nes.read(addr));
    }
};
opTable[0xF7] = {
    name: "ISC (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        this.nes.write(addr, this.nes.read(addr) + 1);
        SBC.call(this, this.nes.read(addr));
    }
};
opTable[0xEF] = {
    name: "ISC (abs)",
    bytes: 3,
    cycles: 6,
    execute: function () {
        let addr = this.getRef();
        this.nes.write(addr, this.nes.read(addr) + 1);
        SBC.call(this, this.nes.read(addr));
    }
};
opTable[0xFF] = {
    name: "ISC (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.X);
        this.nes.write(addr, this.nes.read(addr) + 1);
        SBC.call(this, this.nes.read(addr));
    }
};
opTable[0xFB] = {
    name: "ISC (abs, Y)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.Y);
        this.nes.write(addr, this.nes.read(addr) + 1);
        SBC.call(this, this.nes.read(addr));
    }
};
opTable[0xE3] = {
    name: "ISC (ind, X)",
    bytes: 2,
    cycles: 8,
    execute: function () {
        let addr = this.getIndrXRef();
        this.nes.write(addr, this.nes.read(addr) + 1);
        SBC.call(this, this.nes.read(addr));
    }
};
opTable[0xF3] = {
    name: "ISC (abs)",
    bytes: 2,
    cycles: 8,
    execute: function () {
        let addr = this.getIndrYRef();
        this.nes.write(addr, this.nes.read(addr) + 1);
        SBC.call(this, this.nes.read(addr));
    }
};
//SLO
//Shift memory content 1 bit left, then OR with ACC
opTable[0x07] = {
    name: "SLO (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getZPageRef();
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.ACC = this.ACC | this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x17] = {
    name: "SLO (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.ACC = this.ACC | this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x0F] = {
    name: "SLO (abs)",
    bytes: 3,
    cycles: 6,
    execute: function () {
        let addr = this.getRef();
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.ACC = this.ACC | this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x1F] = {
    name: "SLO (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.X);
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.ACC = this.ACC | this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x1B] = {
    name: "SLO (abs, Y)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.Y);
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.ACC = this.ACC | this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x03] = {
    name: "SLO (ind, Y)",
    bytes: 2,
    cycles: 8,
    execute: function () {
        let addr = this.getIndrXRef();
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.ACC = this.ACC | this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x13] = {
    name: "SLO (ind), Y",
    bytes: 2,
    cycles: 8,
    execute: function () {
        let addr = this.getIndrYRef();
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.ACC = this.ACC | this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
//RLA
//Rotate one bit left in memory, AND result with ACC
opTable[0x27] = {
    name: "RLA (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getZPageRef();
        let addBit = this.flags.carry;
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.nes.write(addr, this.nes.read(addr) + addBit);
        this.ACC = this.ACC & this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x37] = {
    name: "RLA (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        let addBit = this.flags.carry;
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.nes.write(addr, this.nes.read(addr) + addBit);
        this.ACC = this.ACC & this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x2F] = {
    name: "RLA (abs)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef();
        let addBit = this.flags.carry;
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.nes.write(addr, this.nes.read(addr) + addBit);
        this.ACC = this.ACC & this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x3F] = {
    name: "RLA (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.X);
        let addBit = this.flags.carry;
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.nes.write(addr, this.nes.read(addr) + addBit);
        this.ACC = this.ACC & this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x3B] = {
    name: "RLA (abs, Y)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.Y);
        let addBit = this.flags.carry;
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.nes.write(addr, this.nes.read(addr) + addBit);
        this.ACC = this.ACC & this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x23] = {
    name: "RLA (ind, X)",
    bytes: 2,
    cycles: 8,
    execute: function () {
        let addr = this.getIndrXRef();
        let addBit = this.flags.carry;
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.nes.write(addr, this.nes.read(addr) + addBit);
        this.ACC = this.ACC & this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x33] = {
    name: "RLA (ind), Y",
    bytes: 2,
    cycles: 8,
    execute: function () {
        let addr = this.getIndrYRef();
        let addBit = this.flags.carry;
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.nes.write(addr, this.nes.read(addr) + addBit);
        this.ACC = this.ACC & this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
//SRE
//Shift memory 1 bit right, then EOR with ACC
opTable[0x47] = {
    name: "SRE (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getZPageRef();
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.ACC = this.ACC ^ this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x57] = {
    name: "SRE (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.ACC = this.ACC ^ this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x4F] = {
    name: "SRE (abs)",
    bytes: 3,
    cycles: 6,
    execute: function () {
        let addr = this.getRef();
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.ACC = this.ACC ^ this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x5F] = {
    name: "SRE (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.X);
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.ACC = this.ACC ^ this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x5B] = {
    name: "SRE (abs, Y)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.Y);
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.ACC = this.ACC ^ this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x43] = {
    name: "SRE (ind, X)",
    bytes: 2,
    cycles: 8,
    execute: function () {
        let addr = this.getIndrXRef();
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.ACC = this.ACC ^ this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x53] = {
    name: "SRE (ind), X",
    bytes: 2,
    cycles: 8,
    execute: function () {
        let addr = this.getIndrYRef();
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.ACC = this.ACC ^ this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
//RRA
//Rotate memory 1 bit right, then ADC with ACC
opTable[0x67] = {
    name: "RRA (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getZPageRef();
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.nes.write(addr, this.nes.read(addr) + addBit);
        ADC.call(this, this.nes.read(addr));
    }
};
opTable[0x77] = {
    name: "RRA (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.nes.write(addr, this.nes.read(addr) + addBit);
        ADC.call(this, this.nes.read(addr));
    }
};
opTable[0x6F] = {
    name: "RRA (abs)",
    bytes: 3,
    cycles: 6,
    execute: function () {
        let addr = this.getRef();
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.nes.write(addr, this.nes.read(addr) + addBit);
        ADC.call(this, this.nes.read(addr));
    }
};
opTable[0x7F] = {
    name: "RRA (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.X);
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.nes.write(addr, this.nes.read(addr) + addBit);
        ADC.call(this, this.nes.read(addr));
    }
};
opTable[0x7B] = {
    name: "RRA (abs, Y)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.Y);
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.nes.write(addr, this.nes.read(addr) + addBit);
        ADC.call(this, this.nes.read(addr));
    }
};
opTable[0x63] = {
    name: "RRA (ind, X)",
    bytes: 2,
    cycles: 8,
    execute: function () {
        let addr = this.getIndrXRef();
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.nes.write(addr, this.nes.read(addr) + addBit);
        ADC.call(this, this.nes.read(addr));
    }
};
opTable[0x73] = {
    name: "RRA (ind), Y",
    bytes: 2,
    cycles: 8,
    execute: function () {
        let addr = this.getIndrYRef();
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.nes.write(addr, this.nes.read(addr) + addBit);
        ADC.call(this, this.nes.read(addr));
    }
};
//LAR
//AND memory w/ SP, store result in ACC, X, and SP
opTable[0xBB] = {
    name: "LAR (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef(this.Y);
        this.SP = this.SP & this.nes.read(addr);
        this.X = this.SP;
        this.ACC = this.X;
        this.updateNumStateFlags(this.ACC);
    }
};
//ATX
//AND byte with ACC, transfer ACC to X
opTable[0xAB] = {
    name: "ATX (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        this.ACC = this.ACC & this.nextByte();
        this.X = this.ACC;
        this.updateNumStateFlags(this.ACC);
    }
};
function combineHex(hiByte, lowByte) {
    return (hiByte << 8) | (lowByte);
}
function splitHex(hex) {
    let str = hex.toString(16).padStart(4, "0");
    let hiByte = parseInt(str.substr(0, 2), 16);
    let loByte = parseInt(str.substr(2), 16);
    return [hiByte, loByte];
}
function addWrap(reg, add) {
    reg = reg + add;
    if (reg > 0xFF) {
        reg = 0x00;
    }
    if (reg < 0x00) {
        reg = 0xFF;
    }
    return reg;
}
function insertInto(addr, byte, i, j1, j2) {
    let mask = 0xFFFF;
    mask ^= (Math.pow(2, (j1 - j2)) - 1) << (i - (j1 - j2));
    addr &= mask; //Clear relevant bits
    //Slice/Shift byte
    byte &= (Math.pow(2, (j1 - j2)) - 1) << j2;
    byte >>= j2;
    byte <<= (i - (j1 - j2));
    return addr | byte;
}
class Input {
    constructor() {
        this.defaultBind = {
            p1: {
                a: { code: 18, name: "Alt" },
                b: { code: 32, name: "Space" },
                select: { code: 17, name: "Control" },
                start: { code: 13, name: "Enter" },
                up: { code: 87, name: "W" },
                down: { code: 83, name: "S" },
                left: { code: 65, name: "A" },
                right: { code: 68, name: "D" },
            },
            p2: {
                a: { code: 78, name: "N" },
                b: { code: 77, name: "M" },
                select: { code: 17, name: "Control" },
                start: { code: 13, name: "Enter" },
                up: { code: 38, name: "ArrowUp" },
                down: { code: 40, name: "ArrowDown" },
                left: { code: 37, name: "ArrowLeft" },
                right: { code: 39, name: "ArrowRight" },
            }
        };
        this.bindings = this.defaultBind;
        this.p1 = {
            buttons: {
                a: false,
                b: false,
                select: false,
                start: false,
                up: false,
                down: false,
                left: false,
                right: false
            },
            strobe: false,
            shiftReg: []
        };
        this.p2 = {
            buttons: {
                a: false,
                b: false,
                select: false,
                start: false,
                up: false,
                down: false,
                left: false,
                right: false
            },
            strobe: false,
            shiftReg: []
        };
    }
    setStrobe(on) {
        this.p1.strobe = on;
        this.p2.strobe = on;
        if (!on) {
            this.p1.shiftReg = [];
            this.p2.shiftReg = [];
            let keys = Object.getOwnPropertyNames(this.p1.buttons);
            for (let i = 0; i < keys.length; i++) {
                this.p1.shiftReg.push(+this.p1.buttons[keys[i]]);
                this.p2.shiftReg.push(+this.p2.buttons[keys[i]]);
            }
        }
    }
    read(addr) {
        let p = (addr == 0x4016) ? this.p1 : this.p2;
        if (p.strobe)
            return +p.buttons.a;
        if (p.shiftReg.length == 0)
            return 1;
        return p.shiftReg.shift();
    }
    //Sets the button flag, returns if the key pressed was used
    setBtn(keyCode, isDown) {
        let p1 = this.p1.buttons;
        let p2 = this.p2.buttons;
        let bind1 = this.bindings.p1;
        let bind2 = this.bindings.p2;
        switch (keyCode) {
            case bind1.a.code:
                p1.a = isDown;
                return true;
            case bind1.b.code:
                p1.b = isDown;
                return true;
            case bind1.select.code:
                p1.select = isDown;
                return true;
            case bind1.start.code:
                p1.start = isDown;
                return true;
            case bind1.up.code:
                p1.up = isDown;
                return true;
            case bind1.down.code:
                p1.down = isDown;
                return true;
            case bind1.left.code:
                p1.left = isDown;
                return true;
            case bind1.right.code:
                p1.right = isDown;
                return true;
            case bind2.a.code:
                p2.a = isDown;
                return true;
            case bind2.b.code:
                p2.b = isDown;
                return true;
            case bind2.select.code:
                p2.select = isDown;
                return true;
            case bind2.start.code:
                p2.start = isDown;
                return true;
            case bind2.up.code:
                p2.up = isDown;
                return true;
            case bind2.down.code:
                p2.down = isDown;
                return true;
            case bind2.left.code:
                p2.left = isDown;
                return true;
            case bind2.right.code:
                p2.right = isDown;
                return true;
        }
        return false;
    }
    reset() {
        this.bindings = this.defaultBind;
        let btns = $("#p1Controls > table > tr > td:nth-child(2) > button");
        let bind = this.bindings.p1;
        let keys = Object.getOwnPropertyNames(bind);
        for (let i = 0; i < keys.length; i++) {
            btns[i].innerHTML = bind[keys[i]].name;
        }
        btns = $("#p2Controls > table > tr > td:nth-child(2) > button");
        bind = this.bindings.p2;
        keys = Object.getOwnPropertyNames(bind);
        for (let i = 0; i < keys.length; i++) {
            btns[i].innerHTML = bind[keys[i]].name;
        }
    }
    buildControlTable(div, p1 = true) {
        let pStr = (p1) ? "p1" : "p2";
        let bind = this.bindings[pStr];
        let table = $(document.createElement("table"));
        let keys = Object.getOwnPropertyNames(bind);
        for (let i = 0; i < keys.length; i++) {
            let btn = $(document.createElement("button"));
            btn.html(bind[keys[i]].name);
            btn.on("click", function () {
                btn.html("Press any key...");
                $(document).one("keydown", function (e) {
                    btn.html(e.key);
                    if (e.key.length == 1)
                        btn.html(btn.html().toUpperCase());
                    if (e.keyCode == 32)
                        btn.html("Space");
                    bind[keys[i]].code = e.keyCode;
                    bind[keys[i]].name = btn.html();
                });
            });
            let tr = $(document.createElement("tr"));
            tr.append(`<td>${keys[i]}</td>`);
            let td = $(document.createElement("td"));
            td.append(btn);
            table.append(tr.append(td));
        }
        div.append(table);
        if (!p1) {
            let defBtn = $(document.createElement("button"));
            defBtn.html("Restore Defaults");
            defBtn.on("click", input.reset.bind(this));
            div.after(defBtn);
            div.after("<br>");
        }
    }
}
class iNESFile {
    constructor(buff) {
        //Check if valid iNES file (file starts with 'NES' and character break)
        if (buff[0] !== 0x4E)
            throw Error("Corrupted iNES file!"); //N
        if (buff[1] !== 0x45)
            throw Error("Corrupted iNES file!"); //E
        if (buff[2] !== 0x53)
            throw Error("Corrupted iNES file!"); //S
        if (buff[3] !== 0x1A)
            throw Error("Corrupted iNES file!"); //[END]
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
            this.trainerData = new Uint8Array(buff.slice(startLoc, startLoc + 0x200));
            startLoc += 0x200;
        }
        this.pgrRom = new Uint8Array(buff.slice(startLoc, startLoc + 0x4000 * this.pgrPages));
        startLoc += 0x4000 * this.pgrPages;
        this.chrRom = new Uint8Array(buff.slice(startLoc, startLoc + 0x2000 * this.chrPages));
        startLoc += 0x2000 * this.chrPages;
    }
    load(mem, ppuMem) {
        switch (this.mapNum) {
            case 0: //NROM
                mem.set(this.pgrRom, 0x8000);
                if (this.pgrPages == 1) {
                    mem.set(this.pgrRom, 0xC000);
                }
                ppuMem.set(this.chrRom, 0);
                break;
            default: //Unsupported Mapper
                alert("Warning: Unsupported Mapper\nThis game is not yet supported.");
        }
    }
}
class PPU {
    constructor(nes) {
        this.nes = nes;
        this.oamBuff = [];
        this.sprite0Active = false;
        this.internalReadBuff = 0;
        this.oddFrame = false;
        this.writeLatch = false;
        this.vRamAddr = 0;
        this.initRamAddr = 0;
        this.fineX = 0;
        this.scanline = 261;
        this.dot = 0;
        //Shift registers
        this.bkgQ = [];
        this.attrQ = [];
        //CTRL vars
        this.incAddrBy32 = false; //If false, inc by 1
        this.spritePatAddr = 0;
        this.bkgPatAddr = 0;
        this.sprite8x16 = false; //If false, sprite size is 8x8
        this.masterSlave = false;
        this.vBlankNMI = false;
        //MASK vars
        this.greyscale = false;
        this.showLeftBkg = false;
        this.showLeftSprite = false;
        this.showBkg = false;
        this.showSprites = false;
        this.maxRed = false;
        this.maxGreen = false;
        this.maxBlue = false;
        this.PPUCTRL = 0x2000;
        this.PPUMASK = 0x2001;
        this.PPUSTATUS = 0x2002;
        this.OAMADDR = 0x2003;
        this.OAMDATA = 0x2004;
        this.PPUSCROLL = 0x2005;
        this.PPUADDR = 0x2006;
        this.PPUDATA = 0x2007;
        this.OAMDMA = 0x4014;
        this.mem = new Uint8Array(0x4000);
        this.oam = new Uint8Array(0x100);
        PPU.updateScale(PPU.scale);
    }
    static updateScale(scale) {
        if (scale < 1 || scale % 1 != 0) {
            console.log("Display scale must a positive integer");
            return;
        }
        PPU.scale = scale;
        PPU.canvas.width = 256 * scale;
        PPU.canvas.height = 240 * scale;
        let ctx = PPU.canvas.getContext("2d", { alpha: false });
        ctx.imageSmoothingEnabled = false;
        ctx.mozImageSmoothingEnabled = false;
        ctx.webkitImageSmoothingEnabled = false;
        let imgData = ctx.createImageData(PPU.canvas.width, PPU.canvas.height);
        PPU.ctx = ctx;
        for (let i = 3; i < imgData.data.length; i += 4) {
            imgData.data[i] = 255;
        }
        PPU.imageData = imgData;
    }
    setPixel(r, g, b) {
        if (this.maxGreen || this.maxBlue) {
            r -= 25;
        }
        if (this.maxRed || this.maxBlue) {
            g -= 25;
        }
        if (this.maxRed || this.maxGreen) {
            b -= 25;
        }
        let i = (this.scanline * PPU.imageData.width * 4 + this.dot * 4) * PPU.scale;
        if (PPU.imageData.data[i] != r) {
            for (let row = 0; row < PPU.scale; row++) {
                for (let col = 0; col < PPU.scale; col++) {
                    PPU.imageData.data[i + row * PPU.imageData.width * 4 + col * 4] = r;
                }
            }
        }
        if (PPU.imageData.data[++i] != g) {
            for (let row = 0; row < PPU.scale; row++) {
                for (let col = 0; col < PPU.scale; col++) {
                    PPU.imageData.data[i + row * PPU.imageData.width * 4 + col * 4] = g;
                }
            }
        }
        if (PPU.imageData.data[++i] != b) {
            for (let row = 0; row < PPU.scale; row++) {
                for (let col = 0; col < PPU.scale; col++) {
                    PPU.imageData.data[i + row * PPU.imageData.width * 4 + col * 4] = b;
                }
            }
        }
    }
    paintFrame() {
        PPU.ctx.putImageData(PPU.imageData, 0, 0);
    }
    boot() {
        this.nes.write(this.PPUCTRL, 0);
        this.nes.write(this.PPUMASK, 0);
        this.nes.write(this.PPUSTATUS, 0xA0);
        this.nes.write(this.OAMADDR, 0);
        this.nes.write(this.PPUSCROLL, 0);
        this.nes.write(this.PPUADDR, 0);
        this.nes.write(this.PPUDATA, 0);
        this.oddFrame = false;
    }
    reset() {
        this.nes.write(this.PPUCTRL, 0);
        this.nes.write(this.PPUMASK, 0);
        this.nes.write(this.PPUSCROLL, 0);
        this.nes.write(this.PPUDATA, 0);
        this.oddFrame = false;
    }
    cycle() {
        switch (true) {
            case (this.scanline < 240):
                this.visibleCycle();
                break;
            case (this.scanline < 260):
                if (this.scanline == 241 && this.dot == 1 && this.nes.cpu.cycleCount > 29658)
                    this.setVBL();
                //POST-RENDER
                break;
            case (this.scanline == 261):
                //PRE-RENDER
                if (this.dot == 1) {
                    this.clearVBL();
                    this.clearSprite0();
                    this.clearOverflow();
                }
                else if (this.dot == 328) {
                    if (this.showLeftBkg) {
                        //Get attrTable byte
                        this.attrQ[0] = this.mem[this.getATAddr()];
                        let addr = this.mem[this.getNTAddr()] << 4;
                        let fineY = (this.vRamAddr & 0x7000) >> 12;
                        //Get Low BG byte
                        let lo = this.mem[addr + fineY + this.bkgPatAddr];
                        //Get High BG byte
                        let hi = this.mem[addr + 8 + fineY + this.bkgPatAddr];
                        this.bkgQ[0] = this.combinePatData(hi, lo);
                    }
                    else {
                        this.bkgQ[0] = [0, 0, 0, 0, 0, 0, 0, 0];
                    }
                    if (this.showBkg)
                        this.incCoarseX();
                }
                else if (this.dot == 336) {
                    //Get attrTable byte
                    this.attrQ[1] = this.mem[this.getATAddr()];
                    let addr = this.mem[this.getNTAddr()] << 4;
                    let fineY = (this.vRamAddr & 0x7000) >> 12;
                    //Get Low BG byte
                    let lo = this.mem[addr + fineY + this.bkgPatAddr];
                    //Get High BG byte
                    let hi = this.mem[addr + 8 + fineY + this.bkgPatAddr];
                    this.bkgQ[1] = this.combinePatData(hi, lo);
                    if (this.showBkg)
                        this.incCoarseX();
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
            if (this.showBkg)
                this.vRamAddr = this.initRamAddr;
        }
        if (this.scanline == 239 && this.dot == 256) {
            this.nes.drawFrame = true;
        }
    }
    visibleCycle() {
        if (!this.showBkg) {
            if (this.dot < 256) {
                this.render();
            }
            return;
        }
        if (this.dot <= 256) {
            if (this.dot % 8 == 0 && this.dot != 0) {
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
                }
                else {
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
        }
        else if (this.dot == 257) {
            //Sprite evaulation for next scanline
            this.sprite0Active = false;
            this.oamBuff = [];
            for (let i = 0; i < this.oam.length; i += 4) {
                //If sprite is visible on scanline, add it to 2nd OAM
                if (this.oam[i] <= this.scanline) {
                    if (this.oam[i] > this.scanline - 8 || (this.oam[i] > this.scanline - 16 && this.sprite8x16)) {
                        let entry = {
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
                        entry.x = this.oam[i + 3];
                        entry.paletteNum = (this.oam[i + 2] & 3) + 4;
                        entry.priority = (this.oam[i + 2] & 0x20) == 0;
                        let offSet = this.scanline - this.oam[i];
                        //Flip vertically
                        if ((this.oam[i + 2] & 0x80) != 0) {
                            if (this.sprite8x16) {
                                offSet = 15 - offSet;
                            }
                            else {
                                offSet = 7 - offSet;
                            }
                        }
                        let addr;
                        let lo;
                        let hi;
                        if (this.sprite8x16) {
                            addr = this.oam[i + 1] >> 1;
                            if (offSet > 7)
                                offSet += 8;
                            addr = addr << 5;
                            addr += ((this.oam[i + 1] & 1) == 0) ? 0 : 0x1000;
                            lo = this.mem[addr + offSet];
                            hi = this.mem[addr + offSet + 8];
                        }
                        else {
                            addr = this.oam[i + 1] << 4;
                            lo = this.mem[addr + offSet + this.spritePatAddr];
                            hi = this.mem[addr + offSet + this.spritePatAddr + 8];
                        }
                        entry.patData = this.combinePatData(hi, lo);
                        //Flip horizontally
                        if (this.oam[i + 2] & 0x40)
                            entry.patData = entry.patData.reverse();
                        this.oamBuff.push(entry);
                        if (this.oamBuff.length == 8)
                            break;
                    }
                }
            }
        }
        else if (this.dot == 328) {
            if (this.showLeftBkg) {
                //Get attrTable byte
                this.attrQ[0] = this.mem[this.getATAddr()];
                let addr = this.mem[this.getNTAddr()] << 4;
                let fineY = (this.vRamAddr & 0x7000) >> 12;
                //Get Low BG byte
                let lo = this.mem[addr + fineY + this.bkgPatAddr];
                //Get High BG byte
                let hi = this.mem[addr + 8 + fineY + this.bkgPatAddr];
                this.bkgQ[0] = this.combinePatData(hi, lo);
            }
            else {
                this.bkgQ[0] = [0, 0, 0, 0, 0, 0, 0, 0];
            }
            if (this.showBkg)
                this.incCoarseX();
        }
        else if (this.dot == 336) {
            //Get attrTable byte
            this.attrQ[1] = this.mem[this.getATAddr()];
            let addr = this.mem[this.getNTAddr()] << 4;
            let fineY = (this.vRamAddr & 0x7000) >> 12;
            //Get Low BG byte
            let lo = this.mem[addr + fineY + this.bkgPatAddr];
            //Get High BG byte
            let hi = this.mem[addr + 8 + fineY + this.bkgPatAddr];
            this.bkgQ[1] = this.combinePatData(hi, lo);
            if (this.showBkg)
                this.incCoarseX();
        }
    }
    render() {
        if (!this.showBkg) {
            //Get Universal Background Color and paint a blank pixel
            let palData = this.mem[0x3F00] & 0x3F;
            let col = colorData[palData];
            this.setPixel(col.r, col.g, col.b);
            return;
        }
        let bitSelect = this.dot % 8 + this.fineX;
        if (bitSelect > 7)
            bitSelect -= 8;
        let palData = this.getSpritePix(this.bkgQ[0][bitSelect] != 0);
        if (palData == null || !this.showSprites) {
            //Get PALETTE NUMBER
            let quad;
            let x = ((((this.vRamAddr & 0x1F) - 2) * 8) + this.dot % 8 + this.fineX);
            let y = ((this.vRamAddr & 0x03E0) >> 5) * 8 + ((this.vRamAddr & 0x7000) >> 12);
            if (x % 32 < 16) {
                quad = (y % 32 < 16) ? 0 : 2;
            }
            else {
                quad = (y % 32 < 16) ? 1 : 3;
            }
            let palNum;
            let mask = 3 << (quad * 2);
            palNum = (this.attrQ[0] & mask) >> (quad * 2);
            let palInd = 0x3F00 + palNum * 4 + this.bkgQ[0][bitSelect];
            palData = this.mem[palInd] & 0x3F;
        }
        if (PPU.forceGreyscale || this.greyscale)
            palData &= 0x30;
        let col = colorData[palData];
        this.setPixel(col.r, col.g, col.b);
        if (bitSelect % 8 == 7) {
            this.bkgQ[0] = this.bkgQ[1];
            this.bkgQ[1] = null;
            this.attrQ[0] = this.attrQ[1];
            this.attrQ[1] = null;
        }
    }
    getSpritePix(bkgIsVis) {
        if (!this.showLeftSprite && this.dot < 8)
            return null;
        let entry;
        let pix;
        let sprite0Pix;
        for (let i = 0; i < this.oamBuff.length; i++) {
            if (this.oamBuff[i].x > this.dot - 8 && this.oamBuff[i].x <= this.dot) {
                entry = this.oamBuff[i];
                pix = entry.patData[this.dot - entry.x];
                if (pix == 0) {
                    entry = undefined;
                    pix = undefined;
                    continue;
                }
                if (entry.isSprite0)
                    sprite0Pix = pix;
                if (bkgIsVis && this.sprite0Active && sprite0Pix == undefined) {
                    //Finish searching secondary OAM for sprite0 only
                    for (i; i < this.oamBuff.length; i++) {
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
        if (entry === undefined)
            return null;
        if (bkgIsVis) {
            if (sprite0Pix !== undefined && sprite0Pix != 0)
                this.setSprite0();
            if (!entry.priority)
                return null;
        }
        let palInd = 0x3F00 + entry.paletteNum * 4 + pix;
        return this.mem[palInd] & 0x3F;
    }
    readReg(addr) {
        switch (addr) {
            case this.PPUSTATUS:
                this.writeLatch = false;
                break;
            case this.OAMDATA:
                return this.oam[this.oamAddr];
            case this.PPUDATA:
                let res = this.internalReadBuff;
                this.internalReadBuff = this.mem[this.vRamAddr];
                return res;
        }
        return;
    }
    writeReg(addr) {
        let byte = this.nes.mainMemory[addr];
        switch (addr) {
            case this.PPUCTRL:
                let ntBit = byte & 3;
                this.initRamAddr = insertInto(this.initRamAddr, ntBit, 12, 2, 0);
                this.incAddrBy32 = (byte & 4) != 0;
                if ((byte & 8) != 0) {
                    this.spritePatAddr = 0x1000;
                }
                else {
                    this.spritePatAddr = 0;
                }
                if ((byte & 16) != 0) {
                    this.bkgPatAddr = 0x1000;
                }
                else {
                    this.bkgPatAddr = 0;
                }
                this.sprite8x16 = (byte & 32) != 0;
                this.masterSlave = (byte & 64) != 0;
                if (this.masterSlave)
                    console.log("WARNING: masterSlave mode not currently supported!");
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
                }
                else {
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
                        }
                        else {
                            this.mem[this.vRamAddr - 0x800] = byte;
                        }
                    }
                    else {
                        this.mem[this.vRamAddr] = byte;
                        if ((this.vRamAddr - 0x2000) % 0x800 < 0x400) {
                            this.mem[this.vRamAddr + 0x400] = byte;
                        }
                        else {
                            this.mem[this.vRamAddr - 0x400] = byte;
                        }
                    }
                }
                else {
                    this.mem[this.vRamAddr] = byte;
                }
                if (this.incAddrBy32) {
                    this.vRamAddr += 32;
                }
                else {
                    this.vRamAddr += 1;
                }
                break;
            case this.OAMADDR:
                this.oamAddr = byte;
                break;
            case this.OAMDATA:
                this.oam[this.oamAddr++] = byte;
                if (this.oamAddr > 0xFF)
                    this.oamAddr = 0;
                break;
            case this.OAMDMA:
                let slice = this.nes.mainMemory.slice((byte << 8), ((byte + 1) << 8));
                this.oam.set(slice, 0);
                //Catch up to the 514 CPU cycles used
                for (let i = 0; i < 514 * 3; i++) {
                    this.cycle();
                }
                break;
            case this.PPUSCROLL:
                if (!this.writeLatch) {
                    this.initRamAddr = insertInto(this.initRamAddr, byte, 5, 8, 3);
                    this.fineX = byte & 7;
                }
                else {
                    this.initRamAddr = insertInto(this.initRamAddr, byte, 15, 3, 0);
                    this.initRamAddr = insertInto(this.initRamAddr, byte, 10, 8, 3);
                }
                this.writeLatch = !this.writeLatch;
                break;
        }
    }
    combinePatData(hi, lo) {
        let pByte = [];
        let mask;
        for (let i = 0; i < 8; i++) {
            mask = 1 << (7 - i);
            if (i > 6) {
                pByte[i] = ((hi & mask) << 1) +
                    (lo & mask);
            }
            else {
                pByte[i] = ((hi & mask) >> (6 - i)) +
                    ((lo & mask) >> (7 - i));
            }
        }
        return pByte;
    }
    incCoarseX() {
        if ((this.vRamAddr & 0x1F) == 31) {
            //Swap nametable, horizontally
            this.vRamAddr &= 0xFFE0; //Set X to 0
            this.vRamAddr ^= 0x400; //Swap NT
        }
        else {
            this.vRamAddr++;
        }
    }
    resetCoarseX() {
        this.vRamAddr = insertInto(this.vRamAddr, this.initRamAddr, 5, 5, 0);
    }
    incY() {
        if ((this.vRamAddr & 0x7000) != 0x7000) {
            this.vRamAddr += 0x1000; //If fineY != 7, inc by 1
        }
        else {
            this.vRamAddr &= 0xFFF; //Reset fineY to 0
            let y = (this.vRamAddr & 0x3E0) >> 5;
            if (y == 29) {
                //Swap nametable, vertically
                y = 0;
                this.vRamAddr ^= 0x800; //Swap NT
            }
            else if (y == 31) {
                y = 0;
            }
            else {
                y += 1;
            }
            let mask = 0xFFFF;
            mask ^= 0x3E0;
            //Put y back into vRamAddr
            this.vRamAddr = (this.vRamAddr & mask) | (y << 5);
        }
    }
    resetCoarseY() {
        this.vRamAddr = insertInto(this.vRamAddr, this.initRamAddr, 10, 10, 5);
    }
    getNTAddr() {
        return 0x2000 | (this.vRamAddr & 0xFFF);
    }
    getATAddr() {
        return 0x23C0 | (this.vRamAddr & 0x0C00) | ((this.vRamAddr >> 4) & 0x38) | ((this.vRamAddr >> 2) & 0x07);
    }
    setVBL() {
        this.nes.write(this.PPUSTATUS, (this.nes.readNoReg(this.PPUSTATUS) | 0x80));
        if (this.vBlankNMI)
            this.nes.cpu.requestNMInterrupt();
    }
    clearVBL() {
        this.nes.write(this.PPUSTATUS, (this.nes.readNoReg(this.PPUSTATUS) & 0x7F));
    }
    clearSprite0() {
        this.nes.write(this.PPUSTATUS, (this.nes.readNoReg(this.PPUSTATUS) & 0xBF));
    }
    setSprite0() {
        this.nes.write(this.PPUSTATUS, (this.nes.readNoReg(this.PPUSTATUS) | 0x40));
    }
    clearOverflow() {
        this.nes.write(this.PPUSTATUS, (this.nes.readNoReg(this.PPUSTATUS) & 0xDF));
    }
}
PPU.forceGreyscale = false;
PPU.ctx = null;
PPU.imageData = null;
PPU.scale = 2;
let colorData = {};
colorData[0x00] = {
    r: 84,
    g: 84,
    b: 84
};
colorData[0x01] = {
    r: 0,
    g: 30,
    b: 116
};
colorData[0x02] = {
    r: 8,
    g: 16,
    b: 144
};
colorData[0x03] = {
    r: 48,
    g: 0,
    b: 136
};
colorData[0x04] = {
    r: 68,
    g: 0,
    b: 100
};
colorData[0x05] = {
    r: 92,
    g: 0,
    b: 48
};
colorData[0x06] = {
    r: 84,
    g: 4,
    b: 0
};
colorData[0x07] = {
    r: 60,
    g: 24,
    b: 0
};
colorData[0x08] = {
    r: 32,
    g: 42,
    b: 0
};
colorData[0x09] = {
    r: 8,
    g: 58,
    b: 0
};
colorData[0x0A] = {
    r: 0,
    g: 64,
    b: 0
};
colorData[0x0B] = {
    r: 0,
    g: 60,
    b: 0
};
colorData[0x0C] = {
    r: 0,
    g: 50,
    b: 60
};
colorData[0x0D] = {
    r: 0,
    g: 0,
    b: 0
};
colorData[0x0E] = {
    r: 0,
    g: 0,
    b: 0
};
colorData[0x0F] = {
    r: 0,
    g: 0,
    b: 0
};
colorData[0x10] = {
    r: 152,
    g: 150,
    b: 152
};
colorData[0x11] = {
    r: 8,
    g: 76,
    b: 196
};
colorData[0x12] = {
    r: 48,
    g: 50,
    b: 236
};
colorData[0x13] = {
    r: 92,
    g: 30,
    b: 228
};
colorData[0x14] = {
    r: 136,
    g: 20,
    b: 176
};
colorData[0x15] = {
    r: 160,
    g: 20,
    b: 100
};
colorData[0x16] = {
    r: 152,
    g: 34,
    b: 32
};
colorData[0x17] = {
    r: 120,
    g: 60,
    b: 0
};
colorData[0x18] = {
    r: 84,
    g: 90,
    b: 0
};
colorData[0x19] = {
    r: 40,
    g: 114,
    b: 0
};
colorData[0x1A] = {
    r: 8,
    g: 124,
    b: 0
};
colorData[0x1B] = {
    r: 0,
    g: 118,
    b: 40
};
colorData[0x1C] = {
    r: 0,
    g: 102,
    b: 120
};
colorData[0x1D] = {
    r: 0,
    g: 0,
    b: 0
};
colorData[0x1E] = {
    r: 0,
    g: 0,
    b: 0
};
colorData[0x1F] = {
    r: 0,
    g: 0,
    b: 0
};
colorData[0x20] = {
    r: 236,
    g: 238,
    b: 236
};
colorData[0x21] = {
    r: 76,
    g: 154,
    b: 236
};
colorData[0x22] = {
    r: 120,
    g: 124,
    b: 236
};
colorData[0x23] = {
    r: 176,
    g: 98,
    b: 236
};
colorData[0x24] = {
    r: 228,
    g: 84,
    b: 236
};
colorData[0x25] = {
    r: 236,
    g: 88,
    b: 180
};
colorData[0x26] = {
    r: 236,
    g: 106,
    b: 100
};
colorData[0x27] = {
    r: 212,
    g: 136,
    b: 32
};
colorData[0x28] = {
    r: 160,
    g: 170,
    b: 0
};
colorData[0x29] = {
    r: 116,
    g: 196,
    b: 0
};
colorData[0x2A] = {
    r: 76,
    g: 208,
    b: 32
};
colorData[0x2B] = {
    r: 56,
    g: 204,
    b: 108
};
colorData[0x2C] = {
    r: 56,
    g: 180,
    b: 204
};
colorData[0x2D] = {
    r: 60,
    g: 60,
    b: 60
};
colorData[0x2E] = {
    r: 0,
    g: 0,
    b: 0
};
colorData[0x2F] = {
    r: 0,
    g: 0,
    b: 0
};
colorData[0x30] = {
    r: 236,
    g: 238,
    b: 236
};
colorData[0x31] = {
    r: 168,
    g: 204,
    b: 236
};
colorData[0x32] = {
    r: 188,
    g: 188,
    b: 236
};
colorData[0x33] = {
    r: 212,
    g: 178,
    b: 236
};
colorData[0x34] = {
    r: 236,
    g: 174,
    b: 236
};
colorData[0x35] = {
    r: 236,
    g: 174,
    b: 212
};
colorData[0x36] = {
    r: 236,
    g: 180,
    b: 176
};
colorData[0x37] = {
    r: 228,
    g: 196,
    b: 144
};
colorData[0x38] = {
    r: 204,
    g: 210,
    b: 120
};
colorData[0x39] = {
    r: 180,
    g: 222,
    b: 120
};
colorData[0x3A] = {
    r: 168,
    g: 226,
    b: 144
};
colorData[0x3B] = {
    r: 152,
    g: 226,
    b: 180
};
colorData[0x3C] = {
    r: 160,
    g: 214,
    b: 228
};
colorData[0x3D] = {
    r: 160,
    g: 162,
    b: 160
};
colorData[0x3E] = {
    r: 0,
    g: 0,
    b: 0
};
colorData[0x3F] = {
    r: 0,
    g: 0,
    b: 0
};
/// <reference path="rom.ts" />
/// <reference path="ppu.ts" />
/// <reference path="input.ts" />
class NES {
    constructor(romData, input) {
        this.MEM_SIZE = 0x10000;
        this.drawFrame = false;
        this.counter = 0;
        let canvas = $("#screen")[0];
        this.mainMemory = new Uint8Array(this.MEM_SIZE);
        this.rom = new iNESFile(romData);
        this.ppu = new PPU(this, canvas);
        this.cpu = new CPU(this);
        //Set up input listeners
        this.input = input;
    }
    boot() {
        this.ppu.boot();
        this.rom.load(this.mainMemory, this.ppu.mem);
        this.cpu.boot();
        this.step();
    }
    step() {
        this.drawFrame = false;
        let error = false;
        while (!this.drawFrame) {
            try {
                let cpuCycles = this.cpu.step();
                for (let j = 0; j < cpuCycles * 3; j++) {
                    this.ppu.cycle();
                }
            }
            catch (e) {
                if (e.name == "Unexpected OpCode") {
                    console.log(e.message);
                    error = true;
                    break;
                }
                throw e;
            }
        }
        this.ppu.paintFrame();
        if (error || this.counter++ < -1) {
            this.displayMem();
            this.displayPPUMem();
        }
        else {
            this.lastAnimFrame = window.requestAnimationFrame(this.step.bind(this));
        }
    }
    read(addr) {
        if (addr >= 0x2000 && addr <= 0x3FFF) {
            let res = this.ppu.readReg(0x2000 + (addr % 8));
            if (res !== undefined)
                return res;
        }
        if (addr == 0x4016 || addr == 0x4017) {
            return this.input.read(addr);
        }
        return this.mainMemory[addr];
    }
    //Skip setting register values when reading
    readNoReg(addr) {
        return this.mainMemory[addr];
    }
    write(addr, data) {
        this.mainMemory[addr] = data;
        if (addr == 0x4016) {
            this.input.setStrobe((data & 1) != 0);
        }
        if (addr == 0x4014) {
            this.ppu.writeReg(addr);
        }
        if (addr >= 0x2000 && addr <= 0x3FFF) {
            for (let i = 0x2000; i < 0x3FFF; i += 8) {
                this.mainMemory[i + (addr % 8)] = data;
            }
            this.ppu.writeReg(0x2000 + (addr % 8));
        }
    }
    //Skip setting register values when writing
    writeNoReg(addr, data) {
        if (addr >= 0x2000 && addr <= 0x3FFF) {
            for (let i = 0x2000; i < 0x3FFF; i += 8) {
                this.mainMemory[i + (addr % 8)] = data;
            }
        }
    }
    displayMem() {
        let str = "";
        for (let i = 0; i < this.mainMemory.length; i++) {
            str += this.mainMemory[i].toString(16).padStart(2, "0").toUpperCase();
        }
        $("#mem").html(str);
    }
    displayPPUMem() {
        let str = "";
        for (let i = 0; i < this.ppu.mem.length; i++) {
            str += this.ppu.mem[i].toString(16).padStart(2, "0").toUpperCase();
        }
        $("#ppuMem").html(str);
    }
    displayOAMMem() {
        let str = "";
        for (let i = 0; i < this.ppu.oam.length; i++) {
            str += this.ppu.oam[i].toString(16).padStart(2, "0").toUpperCase();
        }
        $("#ppuMem").html(str);
    }
}
//Initialize NES
let nes;
PPU.canvas = $("#screen")[0];
PPU.canvas.getContext('2d', { alpha: false });
$("#scale").change(function (e) {
    PPU.updateScale(parseInt($("#scale")[0].value));
});
let input = new Input();
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
input.buildControlTable($("#p1Controls"));
input.buildControlTable($("#p2Controls"), false);
$('#file-input').change(init);
function init(e) {
    if (nes !== undefined) {
        window.cancelAnimationFrame(nes.lastAnimFrame);
    }
    let file = e.target.files[0];
    if (!file) {
        return;
    }
    let reader = new FileReader();
    reader.onload = function (e) {
        let firstBoot = nes == undefined;
        nes = new NES(new Uint8Array(e.target.result), input);
        if (firstBoot) {
            $("#greyscale").prop("disabled", false);
        }
        nes.boot();
    };
    reader.readAsArrayBuffer(file);
}
