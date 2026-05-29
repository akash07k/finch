# Finch: hear your browser

Your browser does a hundred small things a day and tells you about almost none of them. Finch gives it a voice. It plays a short, distinct sound the moment something happens: open a tab and you hear a cue, finish a download and you hear another. Page loads, bookmarks, closed windows, a navigation that fails, each one its own brief, recognizable sound. It runs on Chrome, Microsoft Edge, Brave, Firefox, and other Chromium- and Gecko-based browsers. It's free and open source, and it's available now for everyone!

I have been running it across my own machines and browsers for over a month and a half, and it feels rock solid for a public release.

The name is the bird. Finches are songbirds, and the species tell themselves apart by their calls. Same idea here. Every event has its own sound, and after a day or two you stop thinking about it and just know what your browser did from across the room.

## Why I made it

I am a sound lover, and honestly this began as nostalgia. Back in the Windows XP and Windows 7 days, Internet Explorer let you switch on a sound for "navigation complete", the little cue that a page had finished loading, and the click you heard when you followed a link was on by default. I loved that. I loved the whole sound set that shipped with Windows 95, 98, XP, and 7 while I was at it. Somewhere along the way browsers went quiet, and a part of me always wanted that feedback back.

The more I sat with the idea, though, the more I realized the people who would get the most out of it were not people like me.

A screen reader reads the page. It does not tell you about the things sighted users catch out of the corner of their eye: the download icon that lights up, the background tab that quietly finishes loading, the small flash of confirmation when a bookmark saves. Those signals never get announced. If you can't see the screen, you either miss them or you stop what you're doing and go check.

That is the gap Finch fills. It is built first for blind and low-vision users, and the whole thing is designed around that. Every control has a real accessible name, state changes get announced, and the sounds are short and quiet enough to sit under a screen reader's voice instead of fighting it.

If you're sighted, it is still useful, just for different reasons. When you have more tabs open than you can keep track of, or a download running in a window you're not looking at, the audio tells you what happened without you having to switch back and look.

## What you can do with it

There are 65 events in total, grouped into three tiers. A sensible set is on the moment you install it: tabs opening, closing, and switching, pages starting and finishing loading, downloads starting, completing, and failing, bookmarks added and removed, windows opening, closing, and gaining focus, a tab's title changing, even the extension itself being installed or updated. The rest are opt-in, so you turn on as much or as little as you want. A few noisy ones are off by default and waiting there if you ever need them.

Every event is configured on its own. You set the volume and the pitch per event, and there is a preview button so you can hear a sound before you commit to it. There is a master mute, plus a separate "mute when the browser is not focused" toggle for when you tab away to something else and don't want stray noises. Alt+M mutes everything from anywhere, without opening the options page first.

Sounds come in themes. Finch ships with one called Pulse: clean, short cues meant to stay out of the way. More themes are in the works and will land in coming updates, and the ability to import your own is on the roadmap too.

This is also where I could use a hand. If you design sound and a project like this sounds like a fun thing to put your work into, I would genuinely love to hear from you. Good cues are harder than they look, and more than anything else, Finch needs sounds.

## The hard part was not being annoying

The tricky thing about this idea is that browsers fire events in bursts. Click a link and in under a second the browser may report navigation starting, page loading, navigation committed, DOM ready, and page loaded. That is five events for one thing you did. Five sounds for one click is unbearable.

So Finch leans hard on suppression. There is a short global cooldown after any sound, which swallows the rest of a burst while letting the first one through. Events that actually matter, like an error or a finished page load, are allowed to interrupt and play over something less important that is already in progress. And events that tend to rapid-fire on their own get a per-event debounce on top of that. The result is that you hear the thing that mattered, not the machinery behind it.

## Privacy

Finch collects nothing. No analytics, no telemetry, no crash reports, no accounts, no server it phones home to. Your settings live in the browser's own extension storage and never leave the machine. The sound files are bundled inside the extension, so it does not fetch anything off the network either.

It also does not read page content, touch the sites you visit, inject scripts, or block ads. It listens to browser-level events (tabs, downloads, bookmarks, navigation) and plays a sound. That is the entire job.

## Where to get it

You need a reasonably recent browser: Chrome 140 or newer, Firefox 142 or newer.

- Chrome, Edge, Brave, and other Chromium-based browsers: <https://chromewebstore.google.com/detail/finch/oibdifnhdjolmckhjlcifnelbonfccfa>
- Firefox and other Gecko-based browsers: <https://addons.mozilla.org/en-US/firefox/addon/finch/>

The code is on GitHub under AGPL-3.0: <https://github.com/akash07k/finch>.

Bug reports, sound themes, and pull requests are all welcome. If you try it and a sound feels wrong, or an event you want is missing, tell me.

## Spread the word

Sharing helps Finch reach the people who will get the most from it: #Accessibility #a11y #ScreenReader #Blind #LowVision #VisuallyImpaired #NVDA #JAWS #VoiceOver #OpenSource #FOSS #BrowserExtension #Firefox #Chrome #Edge #Google #Microsoft #SoundDesign
