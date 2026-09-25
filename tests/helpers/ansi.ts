const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

// Removes ANSI colour codes. Drillbit paints its output with picocolors, which switches itself off
// outside a terminal but is not guaranteed to do so inside every runner, so assertions compare the
// text without styling.
export function plain(text: string | undefined): string {
	return (text ?? '').replace(ANSI, '');
}
