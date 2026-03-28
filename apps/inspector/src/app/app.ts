import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { CommandPaletteComponent } from './command-palette/command-palette.component';

@Component({
  imports: [RouterModule, CommandPaletteComponent],
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected title = 'Claude Inspector';
}
