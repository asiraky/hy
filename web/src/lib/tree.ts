// Grouping flat path lists into the folders they live in. Shared by the
// changed-files card and the panel's worktree tree: the shapes differ (one
// carries diff stats, the other nothing) so the node is generic over whatever
// the caller hangs on a file.

export interface TreeNode<T> {
  /** The full path for a file, and the directory prefix for a folder. */
  path: string;
  /** What the row shows: a basename, or a run of single-child folders collapsed into one label. */
  name: string;
  children?: TreeNode<T>[];
  file?: T;
  additions: number;
  deletions: number;
}

export interface TreeInput<T> {
  path: string;
  file: T;
  additions?: number;
  deletions?: number;
}

/**
 * Group the paths into the folders they live in. Showing basenames in a tree
 * is what lets a row stay readable on a phone: the full path is the shape of
 * the tree above it, so no row has to be truncated in the middle to fit.
 */
export function buildTree<T>(files: TreeInput<T>[]): TreeNode<T>[] {
  const root: TreeNode<T> = { path: "", name: "", children: [], additions: 0, deletions: 0 };

  for (const file of files) {
    const additions = file.additions ?? 0;
    const deletions = file.deletions ?? 0;
    const segments = file.path.split("/").filter(Boolean);
    let node = root;
    node.additions += additions;
    node.deletions += deletions;

    for (let i = 0; i < segments.length; i++) {
      const last = i === segments.length - 1;
      const path = segments.slice(0, i + 1).join("/");
      let next = node.children?.find((c) => c.path === path);
      if (!next) {
        next = { path, name: segments[i], additions: 0, deletions: 0, ...(last ? {} : { children: [] }) };
        node.children?.push(next);
      }
      // One path can be both: a change set may delete `foo` and add `foo/bar`.
      // The node then carries a file and children at once, and the row renders
      // both rather than dropping whichever arrived second.
      if (last) next.file = file.file;
      else if (!next.children) next.children = [];
      next.additions += additions;
      next.deletions += deletions;
      node = next;
    }
  }

  return (root.children ?? []).map(compactChain).sort(byKindThenName);
}

// A folder with one child folder and nothing else is a step on the way to
// somewhere, not a place. Collapsing the run into `apps/web/src` spends one row
// on what would otherwise take three.
function compactChain<T>(node: TreeNode<T>): TreeNode<T> {
  let current = node;
  let name = node.name;
  while (!current.file && current.children?.length === 1 && current.children[0].children) {
    current = current.children[0];
    name = `${name}/${current.name}`;
  }
  return {
    ...current,
    name,
    children: current.children?.map(compactChain).sort(byKindThenName),
  };
}

function byKindThenName<T>(a: TreeNode<T>, b: TreeNode<T>): number {
  const aDir = a.children ? 0 : 1;
  const bDir = b.children ? 0 : 1;
  // A node that is both sorts with the directories, where its children are.
  if (aDir !== bDir) return aDir - bDir;
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
}

/** Every directory path in the tree, for expand/collapse-all controls. */
export function collectDirs<T>(nodes: TreeNode<T>[]): string[] {
  const out: string[] = [];
  const walk = (list: TreeNode<T>[]) => {
    for (const node of list) {
      if (!node.children) continue;
      out.push(node.path);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

export function fileName(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}
