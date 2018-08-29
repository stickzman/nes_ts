# Updates

## 8/29 Update

#### Mapper 2 (UNROM) games now supported

UNROM games are now fully supported. This includes games like _Castlevania_, _Contra_, and _Metal Gear_.

MMC1 games are still only partially supported, but UNROM was easy to implement so I just went ahead and did it, mmk?

* * *

#### Mapper 0 (NROM) games now supported

A list of NES games and their associated mappers can be found [here](http://tuxnes.sourceforge.net/nesmapper.txt).

#### Mapper 1 (MMC1) games partially supported

Currently in the process of building out MMC1 cartridge components. Some games are working, others are buggy, and some are completely broken. _The Legend of Zelda_ is now 100% playable, with minor graphical glitches at the top of the screen that does not impact gameplay.

#### Saves (Battery-Backed RAM) now working

MMC1 games that utilize battery backed RAM (cartridge save games), such as _The Legend of Zelda_, are now stored when you exit the game or close the window. This means when you load up that game next, it will load your save data the same way a NES would if you popped the same cartridge back into it.

#### Configurable Controls

All controls can be reconfigured at the bottom of the page by simply clicking on what button you wish to change.

#### Adjustable Screen Size

You can adjust the screen size by using the "scale:" dropdown at the top right of the screen. You can adjust anyway between the native 256x240 pixel resolution to 5x that. _But beware!_ The **bigger** the screen, the **slower** the game will potentially run, as more pixel need to be updated per frame.

#### Drag 'n' Drop ROMs

You now drag and drop a `.nes` file anyway on the window to load it into the emulator.
