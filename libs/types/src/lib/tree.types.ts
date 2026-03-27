import { RawSessionEntry } from './session.types';

export interface TreeNode {
  entry: RawSessionEntry;
  children: TreeNode[];
  depth: number;
  isSidechain: boolean;
  agentId?: string;
  toolUseId?: string;
  toolResult?: TreeNode;
}

export interface ConversationTree {
  root: TreeNode;
  allNodes: Map<string, TreeNode>;
  mainThread: TreeNode[];
  sidechains: SidechainInfo[];
}

export interface SidechainInfo {
  agentId: string;
  agentType: string;
  description: string;
  parentToolUseId: string;
  rootNode: TreeNode;
  entryCount: number;
}
