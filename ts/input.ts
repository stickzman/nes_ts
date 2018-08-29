class Input {
    private defaultBind = {
        p1: {
            a:      {code: 32, name: "Space"},
            b:      {code: 18, name: "Alt"},
            select: {code: 17, name: "Control"},
            start:  {code: 13, name: "Enter"},
            up:     {code: 87, name: "W"},
            down:   {code: 83, name: "S"},
            left:   {code: 65, name: "A"},
            right:  {code: 68, name: "D"},
        },
        p2: {
            a:      {code: 78, name: "N"},
            b:      {code: 77, name: "M"},
            select: {code: 17, name: "Control"},
            start:  {code: 13, name: "Enter"},
            up:     {code: 38, name: "ArrowUp"},
            down:   {code: 40, name: "ArrowDown"},
            left:   {code: 37, name: "ArrowLeft"},
            right:  {code: 39, name: "ArrowRight"},
        }
    };

    public bindings = (localStorage.getItem("bindings") == null) ?
                this.defaultBind : JSON.parse(localStorage.getItem("bindings"));

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

    public reset() {
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
        localStorage.setItem("bindings", JSON.stringify(this.bindings));
    }

    public buildControlTable(div: JQuery, p1: boolean = true) {
        let pStr = (p1) ? "p1" : "p2";
        let bind = this.bindings[pStr];
        let table = $(document.createElement("table"));
        let keys = Object.getOwnPropertyNames(bind);
        for (let i = 0; i < keys.length; i++) {
            let btn = $(document.createElement("button"));
            btn.html(bind[keys[i]].name);
            btn.on("click", function() {
                btn.html("Press any key...");
                $(document).one("keydown", function(e) {
                    //Capture new key binding
                    btn.html(e.key);
                    if (e.key.length == 1) btn.html(btn.html().toUpperCase());
                    if (e.keyCode == 32) btn.html("Space");
                    bind[keys[i]].code = e.keyCode;
                    bind[keys[i]].name = btn.html();
                    localStorage.setItem("bindings", JSON.stringify(this.bindings));
                }.bind(this));
            }.bind(this));
            let tr = $(document.createElement("tr"));
            tr.append(`<td>${keys[i]}</td>`);
            let td = $(document.createElement("td"));
            td.append(btn);
            table.append(tr.append(td));
        }
        div.append(table);
        if (!p1) {
            let defBtn = $(document.createElement("button"));
            defBtn.html("Restore Defaults")
            defBtn.on("click", input.reset.bind(this));
            div.after(defBtn);
            div.after("<br>");
        }
    }

}
