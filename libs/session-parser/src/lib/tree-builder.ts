import {
  RawSessionEntry,
  TreeNode,
  ConversationTree,
  SidechainInfo,
  ContentBlock,
  ToolUseBlock,
} from '@claude-inspector/types';

export function buildConversationTree(entries: RawSessionEntry[]): ConversationTree {
  const allNodes = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  // Create nodes for all entries
  for (const entry of entries) {
    const node: TreeNode = {
      entry,
      children: [],
      depth: 0,
      isSidechain: entry.isSidechain,
      agentId: undefined,
      toolUseId: undefined,
      toolResult: undefined,
    };

    // Extract tool_use id if present
    if (entry.message?.content && Array.isArray(entry.message.content)) {
      for (const block of entry.message.content as ContentBlock[]) {
        if (block.type === 'tool_use') {
          node.toolUseId = (block as ToolUseBlock).id;
          break;
        }
      }
    }

    allNodes.set(entry.uuid, node);
  }

  // Build parent-child relationships
  for (const [, node] of allNodes) {
    const parentUuid = node.entry.parentUuid;
    if (parentUuid && allNodes.has(parentUuid)) {
      const parent = allNodes.get(parentUuid)!;
      parent.children.push(node);
      node.depth = parent.depth + 1;
    } else {
      roots.push(node);
    }
  }

  // Link tool_use nodes to their tool_result nodes
  const toolUseNodes = new Map<string, TreeNode>();
  for (const [, node] of allNodes) {
    if (node.toolUseId) {
      toolUseNodes.set(node.toolUseId, node);
    }
  }

  for (const [, node] of allNodes) {
    if (node.entry.message?.content && Array.isArray(node.entry.message.content)) {
      for (const block of node.entry.message.content as ContentBlock[]) {
        if (block.type === 'tool_result') {
          const toolUseNode = toolUseNodes.get(
            (block as { tool_use_id: string }).tool_use_id
          );
          if (toolUseNode) {
            toolUseNode.toolResult = node;
          }
        }
      }
    }
  }

  // Build main thread (follow non-sidechain path)
  const mainThread = extractMainThread(roots);

  // Extract sidechains
  const sidechains = extractSidechains(allNodes);

  // Use first root or create a virtual root
  const root = roots.length === 1 ? roots[0] : {
    entry: entries[0],
    children: roots,
    depth: 0,
    isSidechain: false,
  };

  return { root, allNodes, mainThread, sidechains };
}

function extractMainThread(roots: TreeNode[]): TreeNode[] {
  const mainThread: TreeNode[] = [];

  // Find the first non-sidechain root
  let current: TreeNode | undefined = roots.find((r) => !r.isSidechain) || roots[0];

  while (current) {
    mainThread.push(current);
    // Follow the first non-sidechain child
    current = current.children.find((c) => !c.isSidechain);
  }

  return mainThread;
}

function extractSidechains(allNodes: Map<string, TreeNode>): SidechainInfo[] {
  const sidechains: SidechainInfo[] = [];
  const seen = new Set<string>();

  for (const [, node] of allNodes) {
    if (node.isSidechain && !seen.has(node.entry.uuid)) {
      // Find root of this sidechain (walk up until parent is not sidechain)
      let sidechainRoot = node;
      let parent = node.entry.parentUuid
        ? allNodes.get(node.entry.parentUuid)
        : undefined;
      while (parent?.isSidechain) {
        sidechainRoot = parent;
        parent = parent.entry.parentUuid
          ? allNodes.get(parent.entry.parentUuid)
          : undefined;
      }

      if (seen.has(sidechainRoot.entry.uuid)) continue;
      seen.add(sidechainRoot.entry.uuid);

      // Count entries in this sidechain
      let entryCount = 0;
      const countNodes = (n: TreeNode) => {
        entryCount++;
        for (const child of n.children) countNodes(child);
      };
      countNodes(sidechainRoot);

      const agentId = sidechainRoot.entry.toolUseID || sidechainRoot.entry.uuid;

      sidechains.push({
        agentId,
        agentType: 'unknown',
        description: '',
        parentToolUseId: sidechainRoot.entry.parentToolUseID || '',
        rootNode: sidechainRoot,
        entryCount,
      });
    }
  }

  return sidechains;
}
