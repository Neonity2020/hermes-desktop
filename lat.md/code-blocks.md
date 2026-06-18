# Collapsible code blocks

Long fenced code blocks in agent messages render collapsed behind a "Show more" / "Show less" toggle, so a big file dump doesn't bury the rest of the conversation. [[src/renderer/src/components/AgentMarkdown.tsx]]'s `CodeBlock` treats a block as long when it exceeds 15 lines or 800 characters.

## Expansion must survive streaming remounts

The expand/collapse choice is stored in a module-level `Set` keyed by the block's source position, not in plain component state — otherwise it resets to collapsed mid-stream.

While a message is still streaming, react-markdown re-parses the growing markdown on every token. Its index-based child keys shift as the AST grows, so a `CodeBlock` is frequently unmounted and remounted; a per-component `useState(true)` would re-initialize to collapsed on each remount, undoing the user's click.

The fix keys expansion on the opening fence's source offset (`node.position.start.offset`), which is stable as content appends. The `code` component mapper passes it as `blockId`; `CodeBlock` seeds its initial state from `expandedCodeBlocks.has(blockId)` and updates that set on toggle, so an expanded block stays expanded across remounts.
