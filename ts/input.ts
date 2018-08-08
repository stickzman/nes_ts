class Input {
    //P1 controls
    private readonly A: number = 18;
    private readonly B: number = 32;
    private readonly SELECT: number = 17;
    private readonly START: number = 13;
    private readonly UP: number = 87;
    private readonly DOWN: number = 83;
    private readonly LEFT: number = 65;
    private readonly RIGHT: number = 68;

    //P2 controls
    private readonly A2: number = 78;
    private readonly B2: number = 77;
    private readonly SELECT2: number = 17;
    private readonly START2: number = 13;
    private readonly UP2: number = 38;
    private readonly DOWN2: number = 40;
    private readonly LEFT2: number = 37;
    private readonly RIGHT2: number = 39;

    private p1 = {
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

    public p2 = {
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

    constructor() { }

    public setStrobe(on: boolean) {
        this.p1.strobe = on;
        this.p2.strobe = on;
        if (!on) {
            this.p1.shiftReg = [];
            this.p2.shiftReg = [];
            let keys = Object.getOwnPropertyNames(this.p1.buttons);
            for (let i = 0; i < keys.length; i++) {
                this.p1.shiftReg.push( + this.p1.buttons[keys[i]]);
                this.p2.shiftReg.push( + this.p2.buttons[keys[i]]);
            }
        }
    }

    public read(addr: number): number {
        let p = (addr == 0x4016) ? this.p1 : this.p2;
        if (p.strobe) return + p.buttons.a;
        if (p.shiftReg.length == 0) return 1;
        return p.shiftReg.shift();
    }

    //Sets the button flag, returns if the key pressed was used
    public setBtn(keyCode: number, isDown: boolean): boolean {
        let p1 = this.p1.buttons;
        let p2 = this.p2.buttons;
        switch (keyCode) {
            case this.A:
                p1.a = isDown;
                return true;
            case this.B:
                p1.b = isDown;
                return true;
            case this.SELECT:
                p1.select = isDown;
                return true;
            case this.START:
                p1.start = isDown;
                return true;
            case this.UP:
                p1.up = isDown;
                return true;
            case this.DOWN:
                p1.down = isDown;
                return true;
            case this.LEFT:
                p1.left = isDown;
                return true;
            case this.RIGHT:
                p1.right = isDown;
                return true;
            case this.A2:
                p2.a = isDown;
                return true;
            case this.B2:
                p2.b = isDown;
                return true;
            case this.SELECT2:
                p2.select = isDown;
                return true;
            case this.START2:
                p2.start = isDown;
                return true;
            case this.UP2:
                p2.up = isDown;
                return true;
            case this.DOWN2:
                p2.down = isDown;
                return true;
            case this.LEFT2:
                p2.left = isDown;
                return true;
            case this.RIGHT2:
                p2.right = isDown;
                return true;
        }
        return false;
    }

}
