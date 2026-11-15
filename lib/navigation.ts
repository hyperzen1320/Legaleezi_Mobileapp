import { router } from "expo-router";
import type { Href } from "expo-router";

// Two ways to move around this app, and they are not interchangeable.
//
//   openSection(href)  — go to a SECTION: a tab, or any screen that more
//                        than one place links to (the More menu, the
//                        dashboard tiles, the bell drawer). Reuses the
//                        screen if it is already showing rather than
//                        stacking a second copy of it.
//
//   openInTab(href)    — open a screen that sits DEEPER inside ANOTHER
//                        tab's stack: More → Disposed Cases, the
//                        dashboard's Add a case and Today's Board, the
//                        Hearing Track's matters, the bell's boards.
//                        Lays that tab's list underneath it (see below).
//
//   router.push(href)  — go DEEPER from the screen you are standing on:
//                        a list to one of its rows, a record to its
//                        editor. The only thing that should ever add
//                        depth to a stack.
//
//   backToList(href)   — finish here and return to the list you came
//                        from, however deep you got. Pops back to it if
//                        it is behind you; replaces the current screen
//                        with it if it is not. `replace` was being used
//                        for this and it does something different — it
//                        swaps the top screen for the list WITHOUT
//                        removing what is underneath, so saving a matter
//                        left two copies of the dossier on the stack and
//                        going back walked through both.

/** Go to a section of the app. See the note above. */
export function openSection(href: Href): void {
  router.navigate(href);
}

/**
 * Open a screen deep inside another tab's stack, with that stack's list
 * (its `unstable_settings.anchor`) laid underneath it.
 *
 * Without the anchor, a tab that hasn't been visited yet starts its stack
 * at whatever screen it was opened on. More → Disposed Cases on a fresh
 * launch made Disposed Cases the bottom of the Cases stack, so
 * popToTopOnBlur had nothing to unwind to. The next Dashboard → Case
 * Vault then pushed the vault on top of it, and back from the vault went
 * to Disposed Cases instead of the Dashboard.
 */
export function openInTab(href: Href): void {
  router.navigate(href, { withAnchor: true });
}

/**
 * Return to a list after finishing with one of its records — a save, a
 * delete, a create. Unwinds everything above it.
 */
export function backToList(href: Href): void {
  router.dismissTo(href);
}
