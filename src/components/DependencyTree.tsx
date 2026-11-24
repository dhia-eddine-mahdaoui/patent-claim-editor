import { useState } from 'react';
import type { TreeNode } from '../domain/tree';
import { Icon } from './Icon';

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
    return (
      <div className="empty compact">
        <p className="muted">No claims yet. Dependent claims will nest under the claim they refer to.</p>
      </div>
    );
  }

  return <Branch nodes={roots} depth={0} collapsed={collapsed} onToggle={toggle} onSelect={onSelect} />;
}

interface BranchProps {
  nodes: TreeNode[];
  depth: number;
  collapsed: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onSelect: (claimId: string) => void;
}

function Branch({ nodes, depth, collapsed, onToggle, onSelect }: BranchProps) {
  return (
    <ul className={`tree-branch${depth === 0 ? ' tree-root' : ''}`}>
      {nodes.map((node) => {
        const open = !collapsed.has(node.claim.id);
        const hasChildren = node.children.length > 0;
        return (
          <li key={node.claim.id}>
            <div className="tree-row">
              {hasChildren ? (
                <button
                  type="button"
                  className={`twisty${open ? ' open' : ''}`}
                  aria-expanded={open}
                  aria-label={`${open ? 'Collapse' : 'Expand'} claims that depend on claim ${node.claim.number}`}
                  onClick={() => onToggle(node.claim.id)}
                >
                  <Icon name="chevron" size={13} />
                </button>
              ) : (
                <span className="twisty-spacer" aria-hidden="true" />
              )}
              <button type="button" className="tree-label" onClick={() => onSelect(node.claim.id)}>
                <span className="tree-no">{node.claim.number || '?'}</span>
                <span className="tree-preview">{preview(node.claim.text)}</span>
              </button>
              {node.unresolved ? (
                <span className="tag tag-warning">Broken ref</span>
              ) : depth === 0 ? (
                <span className="tag">Independent</span>
              ) : null}
            </div>
            {hasChildren && open && (
              <Branch nodes={node.children} depth={depth + 1} collapsed={collapsed} onToggle={onToggle} onSelect={onSelect} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function preview(text: string): string {
  return text || '(empty)';
}
