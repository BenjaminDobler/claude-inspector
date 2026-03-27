import {
  Component,
  ElementRef,
  Input,
  OnChanges,
  SimpleChanges,
  ViewChild,
  AfterViewInit,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import * as d3 from 'd3';
import { RawSessionEntry, ContentBlock, ToolUseBlock } from '@claude-inspector/types';
import { getEntryType, extractTextContent, buildConversationTree } from '@claude-inspector/session-parser';

@Component({
  selector: 'app-conversation-tree',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="tree-container">
      <div #treeChart class="tree-chart"></div>
      @if (selectedNode()) {
        <div class="node-detail">
          <div class="node-header">
            <span class="node-type" [attr.data-type]="selectedNodeType()">{{ selectedNodeType() }}</span>
            <span class="node-time">{{ formatTime(selectedNode()!.timestamp) }}</span>
            @if (selectedNode()!.isSidechain) {
              <span class="sidechain-badge">sidechain</span>
            }
          </div>
          <div class="node-content">{{ selectedNodeContent() }}</div>
        </div>
      }
    </div>
  `,
  styleUrl: './conversation-tree.component.scss',
})
export class ConversationTreeComponent implements AfterViewInit, OnChanges {
  @ViewChild('treeChart', { static: true }) chartRef!: ElementRef<HTMLDivElement>;
  @Input() entries: RawSessionEntry[] = [];

  selectedNode = signal<RawSessionEntry | null>(null);
  selectedNodeType = signal<string>('');
  selectedNodeContent = signal<string>('');

  ngAfterViewInit() {
    this.render();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['entries'] && this.chartRef) {
      this.render();
    }
  }

  formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString();
  }

  private render() {
    const container = this.chartRef.nativeElement;
    container.innerHTML = '';

    if (!this.entries.length) return;

    const tree = buildConversationTree(this.entries);
    const mainThread = tree.mainThread;

    if (mainThread.length === 0) return;

    const nodeHeight = 32;
    const nodeWidth = 200;
    const margin = { top: 20, right: 20, bottom: 20, left: 20 };
    const width = container.clientWidth - margin.left - margin.right;
    const totalHeight = mainThread.length * nodeHeight + margin.top + margin.bottom;

    const svg = d3
      .select(container)
      .append('svg')
      .attr('width', width + margin.left + margin.right)
      .attr('height', Math.max(totalHeight, 300));

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Color mapping
    const colorMap: Record<string, string> = {
      user_message: '#58a6ff',
      assistant_message: '#3fb950',
      tool_use: '#d29922',
      tool_result: '#8b949e',
      thinking: '#f0883e',
      progress: '#bc8cff',
      system: '#484f58',
      other: '#484f58',
    };

    // Draw main thread as a vertical list
    const centerX = width / 2;

    // Connecting line
    g.append('line')
      .attr('x1', centerX)
      .attr('y1', 0)
      .attr('x2', centerX)
      .attr('y2', mainThread.length * nodeHeight)
      .attr('stroke', '#30363d')
      .attr('stroke-width', 2);

    mainThread.forEach((node, i) => {
      const y = i * nodeHeight + nodeHeight / 2;
      const type = getEntryType(node.entry);
      const color = colorMap[type] ?? '#484f58';

      let label = '';
      if (type === 'tool_use' && node.entry.message?.content && Array.isArray(node.entry.message.content)) {
        const toolBlock = (node.entry.message.content as ContentBlock[]).find(
          (b) => b.type === 'tool_use'
        ) as ToolUseBlock | undefined;
        label = toolBlock?.name || 'tool';
      } else if (type === 'user_message') {
        label = 'User';
      } else if (type === 'assistant_message') {
        label = 'Assistant';
      } else if (type === 'tool_result') {
        label = 'Result';
      } else if (type === 'thinking') {
        label = 'Thinking';
      } else if (type === 'system') {
        label = 'System';
      } else {
        label = type;
      }

      // Node circle
      g.append('circle')
        .attr('cx', centerX)
        .attr('cy', y)
        .attr('r', 6)
        .attr('fill', color)
        .attr('cursor', 'pointer')
        .on('click', () => {
          this.selectedNode.set(node.entry);
          this.selectedNodeType.set(type);
          this.selectedNodeContent.set(extractTextContent(node.entry));
        })
        .on('mouseenter', function () {
          d3.select(this).attr('r', 9);
        })
        .on('mouseleave', function () {
          d3.select(this).attr('r', 6);
        });

      // Label
      g.append('text')
        .attr('x', centerX + 16)
        .attr('y', y + 4)
        .text(label)
        .style('fill', color)
        .style('font-size', '11px')
        .style('font-family', "'SF Mono', 'Fira Code', monospace")
        .attr('cursor', 'pointer')
        .on('click', () => {
          this.selectedNode.set(node.entry);
          this.selectedNodeType.set(type);
          this.selectedNodeContent.set(extractTextContent(node.entry));
        });

      // Sidechain branches
      if (node.children.filter((c) => c.isSidechain).length > 0) {
        const sidechainChildren = node.children.filter((c) => c.isSidechain);
        sidechainChildren.forEach((sc, sci) => {
          const branchX = centerX - 80 - sci * 40;

          // Branch line
          g.append('line')
            .attr('x1', centerX)
            .attr('y1', y)
            .attr('x2', branchX)
            .attr('y2', y)
            .attr('stroke', '#bc8cff')
            .attr('stroke-width', 1)
            .attr('stroke-dasharray', '4,4');

          g.append('circle')
            .attr('cx', branchX)
            .attr('cy', y)
            .attr('r', 5)
            .attr('fill', '#bc8cff')
            .attr('opacity', 0.7);

          g.append('text')
            .attr('x', branchX - 8)
            .attr('y', y - 8)
            .text('agent')
            .style('fill', '#bc8cff')
            .style('font-size', '9px')
            .attr('text-anchor', 'end');
        });
      }
    });
  }
}
