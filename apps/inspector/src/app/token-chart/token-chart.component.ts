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
import { TokenDataPoint } from '@claude-inspector/types';

@Component({
  selector: 'app-token-chart',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="chart-container">
      <div #chartEl class="chart"></div>
    </div>
  `,
  styleUrl: './token-chart.component.scss',
})
export class TokenChartComponent implements AfterViewInit, OnChanges {
  @ViewChild('chartEl', { static: true }) chartRef!: ElementRef<HTMLDivElement>;
  @Input() dataPoints: TokenDataPoint[] = [];

  ngAfterViewInit() {
    this.render();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['dataPoints'] && this.chartRef) {
      this.render();
    }
  }

  private render() {
    const container = this.chartRef.nativeElement;
    container.innerHTML = '';

    if (!this.dataPoints.length) return;

    const margin = { top: 20, right: 20, bottom: 40, left: 60 };
    const width = container.clientWidth - margin.left - margin.right;
    const height = 250 - margin.top - margin.bottom;

    const svg = d3
      .select(container)
      .append('svg')
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom);

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3
      .scaleLinear()
      .domain([0, this.dataPoints.length - 1])
      .range([0, width]);

    const maxTokens = d3.max(this.dataPoints, (d) => d.cumulativeTotal) ?? 1;
    const y = d3.scaleLinear().domain([0, maxTokens]).range([height, 0]);

    // Axes
    g.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x).ticks(10).tickFormat((d) => `#${d}`))
      .selectAll('text')
      .style('fill', '#8b949e')
      .style('font-size', '10px');

    g.append('g')
      .call(
        d3.axisLeft(y).ticks(6).tickFormat((d) => {
          const val = d as number;
          if (val >= 1000000) return `${(val / 1000000).toFixed(1)}M`;
          if (val >= 1000) return `${(val / 1000).toFixed(0)}K`;
          return val.toString();
        })
      )
      .selectAll('text')
      .style('fill', '#8b949e')
      .style('font-size', '10px');

    g.selectAll('path, line').style('stroke', '#30363d');

    // Stacked areas
    const layers = [
      { key: 'cumulativeInput' as const, color: '#58a6ff', label: 'Input' },
      { key: 'cumulativeOutput' as const, color: '#3fb950', label: 'Output' },
      { key: 'cumulativeCacheRead' as const, color: '#d29922', label: 'Cache Read' },
      { key: 'cumulativeCacheCreation' as const, color: '#bc8cff', label: 'Cache Create' },
    ];

    // Draw as individual lines (simpler than stacked areas, more readable)
    for (const layer of layers) {
      const line = d3
        .line<TokenDataPoint>()
        .x((d) => x(d.index))
        .y((d) => y(d[layer.key]))
        .curve(d3.curveMonotoneX);

      g.append('path')
        .datum(this.dataPoints)
        .attr('fill', 'none')
        .attr('stroke', layer.color)
        .attr('stroke-width', 2)
        .attr('opacity', 0.8)
        .attr('d', line);
    }

    // Tooltip line
    const tooltipLine = g
      .append('line')
      .attr('y1', 0)
      .attr('y2', height)
      .attr('stroke', '#484f58')
      .attr('stroke-dasharray', '4,4')
      .style('display', 'none');

    const tooltipGroup = g.append('g').style('display', 'none');
    const tooltipBg = tooltipGroup
      .append('rect')
      .attr('fill', '#1c2128')
      .attr('stroke', '#30363d')
      .attr('rx', 4)
      .attr('width', 160)
      .attr('height', 80);
    const tooltipText = tooltipGroup
      .append('text')
      .attr('fill', '#c9d1d9')
      .attr('font-size', '11px');

    // Hover overlay
    g.append('rect')
      .attr('width', width)
      .attr('height', height)
      .attr('fill', 'transparent')
      .on('mousemove', (event: MouseEvent) => {
        const [mx] = d3.pointer(event);
        const idx = Math.round(x.invert(mx));
        const dp = this.dataPoints[Math.max(0, Math.min(idx, this.dataPoints.length - 1))];
        if (!dp) return;

        tooltipLine
          .attr('x1', x(dp.index))
          .attr('x2', x(dp.index))
          .style('display', null);

        const tx = Math.min(x(dp.index) + 10, width - 170);
        tooltipGroup.attr('transform', `translate(${tx}, 5)`).style('display', null);
        tooltipText.selectAll('tspan').remove();
        tooltipText
          .append('tspan')
          .attr('x', 8)
          .attr('dy', 16)
          .text(`Message #${dp.index}`);
        tooltipText
          .append('tspan')
          .attr('x', 8)
          .attr('dy', 14)
          .attr('fill', '#58a6ff')
          .text(`Input: ${this.formatTokens(dp.cumulativeInput)}`);
        tooltipText
          .append('tspan')
          .attr('x', 8)
          .attr('dy', 14)
          .attr('fill', '#3fb950')
          .text(`Output: ${this.formatTokens(dp.cumulativeOutput)}`);
        tooltipText
          .append('tspan')
          .attr('x', 8)
          .attr('dy', 14)
          .attr('fill', '#d29922')
          .text(`Cache Read: ${this.formatTokens(dp.cumulativeCacheRead)}`);
        tooltipText
          .append('tspan')
          .attr('x', 8)
          .attr('dy', 14)
          .attr('fill', '#bc8cff')
          .text(`Cache Create: ${this.formatTokens(dp.cumulativeCacheCreation)}`);

        tooltipBg.attr('height', 90);
      })
      .on('mouseleave', () => {
        tooltipLine.style('display', 'none');
        tooltipGroup.style('display', 'none');
      });

    // Legend
    const legend = svg.append('g').attr('transform', `translate(${margin.left}, 8)`);
    layers.forEach((layer, i) => {
      const lg = legend.append('g').attr('transform', `translate(${i * 120}, 0)`);
      lg.append('line')
        .attr('x1', 0)
        .attr('x2', 14)
        .attr('stroke', layer.color)
        .attr('stroke-width', 2);
      lg.append('text')
        .attr('x', 18)
        .attr('y', 4)
        .text(layer.label)
        .style('fill', '#8b949e')
        .style('font-size', '10px');
    });
  }

  private formatTokens(n: number): string {
    if (n >= 1000000) return `${(n / 1000000).toFixed(2)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  }
}
