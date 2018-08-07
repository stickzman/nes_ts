class Input {
    private readonly A: number = 90;
    private readonly B: number = 88;
    private readonly SELECT: number = 17;
    private readonly START: number = 13;
    private readonly UP: number = 38;
    private readonly DOWN: number = 40;
    private readonly LEFT: number = 37;
    private readonly RIGHT: number = 39;

    private strobe: boolean = false;
    private shiftReg: number[] = [];

    public flags = {
        a: false,
        b: false,
        select: false,
        start: false,
        up: false,
        down: false,
        left: false,
        right: false
    };


    constructor() { }

    public setStrobe(on: boolean) {
        this.strobe = on;
        if (!on) {
            this.shiftReg = [];
            let keys = Object.getOwnPropertyNames(this.flags);
            for (let i = 0; i < keys.length; i++) {
                this.shiftReg.push( + this.flags[keys[i]]);
            }
        }
    }

    public read(): number {
        if (this.strobe) return + this.flags.a;
        if (this.shiftReg.length == 0) return 1;
        return this.shiftReg.shift();
    }

    //Sets the button flag, returns if the key pressed was used
    public setBtn(keyCode: number, isDown: boolean): boolean {
        switch (keyCode) {
            case this.A:
                this.flags.a = isDown;
                return true;
            case this.B:
                this.flags.b = isDown;
                return true;
            case this.SELECT:
                this.flags.select = isDown;
                return true;
            case this.START:
                this.flags.start = isDown;
                return true;
            case this.UP:
                this.flags.up = isDown;
                return true;
            case this.DOWN:
                this.flags.down = isDown;
                return true;
            case this.LEFT:
                this.flags.left = isDown;
                return true;
            case this.RIGHT:
                this.flags.right = isDown;
                return true;
        }
        return false;
    }

}
