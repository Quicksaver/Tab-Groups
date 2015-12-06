# Tab Groups
Reimplementation of Firefox Tab Groups (Panorama) as an add-on. Find more information and get the latest version at https://addons.mozilla.org/firefox/addon/tab-groups-panorama/

## Localization

If you wish to localize the add-on to your language, you can do so via Babelzilla. Please, don't submit a localization directly in Github. While I do greatly appreciate the intent, the git repository doesn't include the AMO description strings, and it's much harder for you, and for myself, to keep track of updates to localizations in here.

To localize the add-on:

1. Create an account on http://www.babelzilla.org

2. Register as translator for the add-on: https://www.babelzilla.org/index.php?option=com_wts&Itemid=0&type=show&extension=5749

3. Translate away!

4. When you're finished, change the localization status to "released", so the system notifies me automatically by e-mail, and I will include it in the next update as soon as I can.

## Code Contributions

Whether you'd like to fix bugs or add new features yourself, you're welcome to fork away and make pull requests for pretty much anything you can think of. But be warned: I don't accept anything into my code that I don't agree with or that I don't even understand. So be ready for a series of questions and perhaps a stubborn discussion on my part. :)

- Please try to keep the coding style as similar to the current style as you possibly can. I believe consistency is far more important than anything else, even optimization sometimes.

- Also, please avoid commiting ```'use script';``` to any files. I know it's not the best coding habits, but I do rely on non-strict behavior in a handful of places, and if while coding I eventually run into any conflict with this, I'll never remember to check this factor. Eventually I may fix those parts though, but don't count on it happening any time soon.

- You'll notice every Javascript file has  ```VERSION a.b.c``` version somewhere near the top, usually on the very first line. This is a personal method of organization, and I'd appreciate it if you could bump these versions accordingly when changing files:
  - a - major changes, represents a complete overhaul of the code in the file, hardly distinguishable from before; you probably will never need to bump this; when creating new files just give it a version of 1.0.0.
  - b - mid-level changes, when you add or modify a significant chunk of code that alters the way the rest works; for instance when adding whole new features.
  - c - minor changes, such as most bugfixes; this is probably what you will be bumping most often.
