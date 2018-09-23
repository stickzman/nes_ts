# Updates

## 9/23

#### Performance Improvements

Games should now run smoother at higher resolutions (scale) and on weaker hardware.
_Castlevania 2_, in particular, runs like butter at "Scale: x5" compared to the choppy mess it was previously.

## 9/19

#### Bug Fixes

Various bug fixes.


## 9/18

#### Added more game support!

**MMC1** games are now supported!  
This includes games like _The Legend of Zelda_, _Metroid_, and _MegaMan 1 & 2_.

**MMC3** games are now supported!  
This includes games like _Super Mario Bros 2 & 3_, and every other _MegaMan_.

Also, various bug fixes are included in this update.


## 9/7

#### Added Reset Button

Added a reset button that performs a soft reset of whatever game is being played when pressed.


## 9/6

#### Super Mario Bros fully functional

Through a number of recent bug fixes, one of the most difficult games to emulate is now fully functional.
You can play Super Mario Bros. from beginning to end, glitch-free.


## 9/4

#### Bug Fixes

* Fixed bug where incorrect color data would leak into tiles when scrolling in some games.
* In games that hide the leftmost column of the background, those 8 pixels will now remain hidden while scrolling.
* Fixed bug where pressing "Restore Defaults" for key bindings would prevent future key remappings to occur.

When remapping input keys, you can now press the "Escape" key to cancel the remap.

## 8/30

#### CPU Timing Accuracy Improved
The accuracy of the CPU's cycles has been improved, fixing numerous misc. timing-related bugs such as the parallax scrolling in _Excitebike_ as well as visual glitches when scrolling between screens in _The Legend of Zelda_.


## 8/29

#### Mapper 2 (UNROM) games now supported

UNROM games are now fully supported. This includes games like _Castlevania_, _Contra_, and _Metal Gear_.

MMC1 games are still only partially supported, but UNROM was easy to implement so I just went ahead and did it, mmk?

---

## Initial Launch

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
