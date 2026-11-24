import { useState } from 'react';
import type { TreeNode } from '../domain/tree';

interface Props {
  roots: TreeNode[];
  onSelect: (claimId: string) => void;
}

export function DependencyTree({ roots, onSelect }: Props) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = (id: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (roots.length === 0) {
    return <p className="muted">No claims to show.</p>;
  }

  return <Branch nodes={roots} collapsed={collapsed} onToggle={toggle} onSelect={onSelect} />;
}

interface BranchProps {
  nodes: TreeNode[];
  collapsed: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onSelect: (claimId: string) => void;
}

function Branch({ nodes, collapsed, onToggle, onSelect }: BranchProps) {
  return (
    <ul className="tree-branch">
      {nodes.map((node) => {
        const open = !collapsed.has(node.claim.id);
        const hasChildren = node.children.length > 0;
        return (
          <li key={node.claim.id}>
            <div className="tree-row">
              {hasChildren ? (
                <button
                  type="button"
                  className="twisty"
                  aria-expanded={open}
                  aria-label={`${open ? 'Collapse' : 'Expand'} claims that depend on claim ${node.claim.number}`}
                  onClick={() => onToggle(node.claim.id)}
                >
                  {open ? '▾' : '▸'}
                </button>
              ) : (
                <span className="twisty-spacer" aria-hidden="true" />
              )}
              <button type="button" className="tree-label" onClick={() => onSelect(node.claim.id)}>
                Claim {node.claim.number}
              </button>
              {node.unresolved && <span className="badge warning">Unresolved reference</span>}
              <span className="muted tree-preview">{preview(node.claim.text)}</span>
            </div>
            {hasChildren && open && (
              <Branch nodes={node.children} collapsed={collapsed} onToggle={onToggle} onSelect={onSelect} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function preview(text: string): string {
  if (!text) return '(empty)';
  return text.length > 70 ? `${text.slice(0, 70)}…` : text;
}
