Don't make "guards" or protections. The default framing should be that the reference implementation works and any bugs should be investigated and understood. Reuse code, don't wrap or invent alternatives unless explicilty asked.

For menu changes remember to make both electron and tauri updates. Most should be using the same shared code.

You can't use alert boxes, or native confirm, or whatever here. Gotta be explicit modals for everything.

Don't use the storage key for heavy-file-format its intentionally not set so we can refresh against the file system.

When writting CSS use classes do not use broad overrides and type selectors because they will break things in the HVY embed.

When you make a checkbox always start with check to the left of the label, not top / bottom. No seriously, don't wait for me to tell you its wrong after you make it, go fix it before I review it.

If you want to make README changes, update README.foragents.md instead of
README.md, unless explicitly requested.

When evaluating decisions, consider the forward looking risks of each decision and weigh them as a probability (not a number but a vague high risk, moderate, low). When asking for decisions from the user, present these probabilities and no more than a couple sentences explaining why.

When suggesting UI labels consider whether they are unnecessary or redundant and choose labels with minimal text, often one or two words

When evaluating new libraries always consider: size, maintenance frequency, security, etc.

Don't run full test suites unless there's a good reason. Tests should be organized by features / code and integration versus unit.
