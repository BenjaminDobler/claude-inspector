import {
  Component,
  ElementRef,
  Input,
  OnChanges,
  SimpleChanges,
  ViewChild,
  AfterViewInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import * as d3 from 'd3';
import { RawSessionEntry } from '@claude-inspector/types';
import { getEntryType } from '@claude-inspector/session-parser';

interface TimelineEvent {
  entry: RawSessionEntry;
  type: ReturnType<typeof getEntryType>;
  timestamp: number;
  label: string;
}

@Component({
  selector: 'app-timeline',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="timeline-container">
      <div #timelineChart class="timeline-chart"></div>
      @if (selectedEvent) {
        <div class="event-detail">
          <div class="detail-header">
            <span class="detail-type" [attr.data-type]="selectedEvent.type">{{ selectedEvent.type }}</span>
            <span class="detail-time">{{ formatTime(selectedEvent.timestamp) }}</span>
          </div>
          <div class="detail-label">{{ selectedEvent.label }}</div>
        </div>
      }
    </div>
  `,
  styleUrl: './timeline.component.scss',
})
export class TimelineComponent implements AfterViewInit, OnChanges {
  @ViewChild('timelineChart', { static: true }) chartRef!: ElementRef<HTMLDivElement>;
  @Input() entries: RawSessionEntry[] = [];

  selectedEvent: TimelineEvent | null = null;
  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null;

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

    const events = this.entries
      .filter((e) => e.type !== 'file-history-snapshot')
      .map((entry) => {
        const type = getEntryType(entry);
        let label = '';
        if (type === 'tool_use' && entry.message?.content && Array.isArray(entry.message.content)) {
          const toolBlock = entry.message.content.find((b: any) => b.type === 'tool_use') as any;
          label = toolBlock?.name || 'tool';
        } else if (type === 'user_message') {
          const content = entry.message?.content;
          label = typeof content === 'string'
            ? content.slice(0, 60)
            : Array.isArray(content)
              ? (content.find((b: any) => b.type === 'text') as any)?.text?.slice(0, 60) || 'user'
              : 'user';
        } else if (type === 'assistant_message') {
          const content = entry.message?.content;
          label = Array.isArray(content)
            ? (content.find((b: any) => b.type === 'text') as any)?.text?.slice(0, 60) || 'assistant'
            : 'assistant';
        } else {
          label = type;
        }

        return { entry, type, timestamp: entry.timestamp, label } as TimelineEvent;
      });

    const margin = { top: 20, right: 20, bottom: 30, left: 20 };
    const width = container.clientWidth - margin.left - margin.right;
    const height = 120 - margin.top - margin.bottom;

    const svg = d3
      .select(container)
      .append('svg')
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom);

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const timeExtent = d3.extent(events, (d) => d.timestamp) as [number, number];
    const x = d3.scaleLinear().domain(timeExtent).range([0, width]);

    // X axis
    const timeFormat = (d: d3.NumberValue) => {
      const date = new Date(d as number);
      return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
    };

    g.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x).ticks(8).tickFormat(timeFormat))
      .selectAll('text')
      .style('fill', '#8b949e')
      .style('font-size', '10px');

    g.selectAll('path, line').style('stroke', '#30363d');

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

    // Y positions by type for layering
    const yMap: Record<string, number> = {
      user_message: 10,
      assistant_message: 30,
      thinking: 30,
      tool_use: 50,
      tool_result: 50,
      progress: 70,
      system: 70,
      other: 70,
    };

    // Draw events
    g.selectAll('circle')
      .data(events)
      .enter()
      .append('circle')
      .attr('cx', (d) => x(d.timestamp))
      .attr('cy', (d) => yMap[d.type] ?? 50)
      .attr('r', (d) => (d.type === 'progress' || d.type === 'other' ? 3 : 5))
      .attr('fill', (d) => colorMap[d.type] ?? '#484f58')
      .attr('opacity', 0.8)
      .attr('cursor', 'pointer')
      .on('click', (_event: MouseEvent, d: TimelineEvent) => {
        this.selectedEvent = d;
      })
      .on('mouseenter', function () {
        d3.select(this).attr('r', 8).attr('opacity', 1);
      })
      .on('mouseleave', function (_, d: TimelineEvent) {
        d3.select(this)
          .attr('r', d.type === 'progress' || d.type === 'other' || d.type === 'system' ? 3 : 5)
          .attr('opacity', 0.8);
      });

    // Legend
    const legend = svg
      .append('g')
      .attr('transform', `translate(${margin.left}, 8)`);

    const legendItems = [
      { label: 'User', color: colorMap['user_message'] },
      { label: 'Assistant', color: colorMap['assistant_message'] },
      { label: 'Tool', color: colorMap['tool_use'] },
      { label: 'Thinking', color: colorMap['thinking'] },
      { label: 'Progress', color: colorMap['progress'] },
    ];

    legendItems.forEach((item, i) => {
      const lg = legend.append('g').attr('transform', `translate(${i * 90}, 0)`);
      lg.append('circle').attr('r', 4).attr('fill', item.color);
      lg.append('text')
        .attr('x', 8)
        .attr('y', 4)
        .text(item.label)
        .style('fill', '#8b949e')
        .style('font-size', '10px');
    });

    this.svg = svg;
  }
}
