Don't make "guards" or protections. The default framing should be that the reference implementation works and any bugs should be investigated and understood. Reuse code, don't wrap or invent alternatives unless explicilty asked.

For menu changes remember to make both electron and tauri updates. Most should be using the same shared code.

You can't use alert boxes, or native confirm, or whatever here. Gotta be explicit modals for everything.
