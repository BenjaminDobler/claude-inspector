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
import { ToolStat } from '@claude-inspector/types';

@Component({
  selector: 'app-tool-stats',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="stats-container">
      <div #chartEl class="bar-chart"></div>
      <div class="tool-table">
        <div class="table-header">
          <span>Tool</span>
          <span>Calls</span>
          <span>Errors</span>
          <span>Success</span>
          <span>Avg Duration</span>
        </div>
        @for (tool of tools; track tool.name) {
          <div class="table-row">
            <span class="tool-name">{{ tool.name }}</span>
            <span>{{ tool.callCount }}</span>
            <span [class.error]="tool.errorCount > 0">{{ tool.errorCount }}</span>
            <span>{{ (tool.successRate * 100).toFixed(0) }}%</span>
            <span>{{ tool.avgDurationMs ? (tool.avgDurationMs / 1000).toFixed(1) + 's' : '-' }}</span>
          </div>
        }
      </div>
    </div>
  `,
  styleUrl: './tool-stats.component.scss',
})
export class ToolStatsComponent implements AfterViewInit, OnChanges {
  @ViewChild('chartEl', { static: true }) chartRef!: ElementRef<HTMLDivElement>;
  @Input() tools: ToolStat[] = [];

  ngAfterViewInit() {
    this.renderChart();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['tools'] && this.chartRef) {
      this.renderChart();
    }
  }

  private renderChart() {
    const container = this.chartRef.nativeElement;
    container.innerHTML = '';

    if (!this.tools.length) return;

    const margin = { top: 10, right: 20, bottom: 80, left: 50 };
    const width = container.clientWidth - margin.left - margin.right;
    const height = 200 - margin.top - margin.bottom;

    const svg = d3
      .select(container)
      .append('svg')
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom);

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3
      .scaleBand()
      .domain(this.tools.map((t) => t.name))
      .range([0, width])
      .padding(0.3);

    const maxCalls = d3.max(this.tools, (d) => d.callCount) ?? 1;
    const y = d3.scaleLinear().domain([0, maxCalls]).range([height, 0]);

    // X axis
    g.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x))
      .selectAll('text')
      .style('fill', '#8b949e')
      .style('font-size', '10px')
      .attr('transform', 'rotate(-45)')
      .attr('text-anchor', 'end');

    // Y axis
    g.append('g')
      .call(d3.axisLeft(y).ticks(5))
      .selectAll('text')
      .style('fill', '#8b949e')
      .style('font-size', '10px');

    g.selectAll('path, line').style('stroke', '#30363d');

    // Success bars
    g.selectAll('.bar-success')
      .data(this.tools)
      .enter()
      .append('rect')
      .attr('x', (d) => x(d.name)!)
      .attr('y', (d) => y(d.callCount - d.errorCount))
      .attr('width', x.bandwidth())
      .attr('height', (d) => height - y(d.callCount - d.errorCount))
      .attr('fill', '#3fb950')
      .attr('rx', 3);

    // Error bars (stacked on top)
    g.selectAll('.bar-error')
      .data(this.tools.filter((t) => t.errorCount > 0))
      .enter()
      .append('rect')
      .attr('x', (d) => x(d.name)!)
      .attr('y', (d) => y(d.callCount))
      .attr('width', x.bandwidth())
      .attr('height', (d) => height - y(d.errorCount))
      .attr('fill', '#f85149')
      .attr('rx', 3);
  }
}
