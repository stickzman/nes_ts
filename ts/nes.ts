class NES {
    private readonly MEM_PATH = "mem.hex";
    private readonly MEM_SIZE = 0x10000;
    private mainMemory: Uint8Array;

    private fs = require("fs");

    public boot() {
        /*
        if (this.mainMemory === undefined) {
            //Load existing memory, otherwise create empty [filled with 0xFF]
            //buffer and write it to file.
            if (this.fs.existsSync(this.MEM_PATH)) {
                this.loadMemory(this.MEM_PATH);
            } else {
                this.mainMemory = new Uint8Array(0x10000);
                this.mainMemory.fill(0xFF);
            }
        }
        this.reset();
        */
    }

    public loadMemory(filePath: string) {
        this.mainMemory = this.fs.readFileSync(filePath);
    }

    private writeMem() {
        this.fs.writeFileSync(this.MEM_PATH, Buffer.from(this.mainMemory));
    }


}
