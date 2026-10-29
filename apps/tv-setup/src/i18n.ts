/**
 * German for the phone page when the phone is set to German; English
 * otherwise. Source strings are the English texts, as in the TV client.
 */
const DE: Record<string, string> = {
    'Add a source · meddl TV': 'Quelle hinzufügen · meddl TV',
    'TV EDITION': 'TV EDITION',
    'YOUR PHONE. YOUR SCREEN.': 'DEIN HANDY. DEIN FERNSEHER.',
    'A new source for your TV.': 'Eine neue Quelle für deinen Fernseher.',
    'Paste the details here, then confirm on your television.':
        'Gib die Zugangsdaten hier ein und bestätige dann am Fernseher.',
    'Connecting to your TV…': 'Verbindung zum Fernseher …',
    'Source type': 'Art der Quelle',
    'Stalker / Ministra': 'Stalker / Ministra',
    'M3U playlist': 'M3U-Playlist',
    Name: 'Name',
    'My subscription': 'Mein Abo',
    'Provider URL': 'Anbieter-Adresse (URL)',
    'Playlist URL': 'Playlist-Adresse (URL)',
    Username: 'Benutzername',
    Password: 'Passwort',
    'MAC address': 'MAC-Adresse',
    'Existing MAG identity / optional account details': 'Vorhandene MAG-Kennung / weitere Kontodaten (optional)',
    'Use the identity supplied by your provider. Leave unused fields empty.':
        'Nutze die Angaben deines Anbieters. Nicht benötigte Felder bleiben leer.',
    'Serial number': 'Seriennummer',
    'Device ID': 'Geräte-ID',
    'Device ID 2': 'Geräte-ID 2',
    Signature: 'Signatur',
    'Signature 2': 'Signatur 2',
    'Send to TV': 'An den Fernseher senden',
    'Your details pass through this meddl backend and are saved on your TV after confirmation. This link expires in five minutes.':
        'Deine Angaben gehen direkt an meddl und werden erst nach deiner Bestätigung auf dem Fernseher gespeichert. Der Link gilt fünf Minuten.',
    'ONE SOURCE. A WHOLE EVENING.': 'EINE QUELLE. EIN GANZER ABEND.',
    'Adjust settings. Confirm on the TV to finish.': 'Passe die Einstellungen an und bestätige am Fernseher.',
    'Enter your source details. Confirm on the TV to finish.': 'Gib deine Zugangsdaten ein und bestätige am Fernseher.',
    'Settings saved on your TV. You can close this page.':
        'Die Einstellungen sind auf dem Fernseher gespeichert. Du kannst diese Seite schließen.',
    'Added to your TV. You can close this page.': 'Auf dem Fernseher hinzugefügt. Du kannst diese Seite schließen.',
    'Changes were declined on the TV. Open a new QR code to try again.':
        'Am Fernseher abgelehnt. Öffne dort einen neuen QR-Code, um es nochmal zu versuchen.',
    'Setup was cancelled on the TV. Open a new QR code to try again.':
        'Am Fernseher abgebrochen. Öffne dort einen neuen QR-Code, um es nochmal zu versuchen.',
    'Sent. Confirm “Apply settings” on your TV.': 'Gesendet. Bestätige am Fernseher mit „Einstellungen übernehmen“.',
    'Sent. Confirm “Add source” on your TV.': 'Gesendet. Bestätige am Fernseher mit „Quelle hinzufügen“.',
    'Connection interrupted.': 'Verbindung unterbrochen.',
    'Could not send. Retry.': 'Senden fehlgeschlagen. Bitte nochmal versuchen.',
    'Could not reach the TV. Try again.': 'Fernseher nicht erreichbar. Bitte nochmal versuchen.',
    'Open a new QR code on the TV. This page needs a one-time setup link.':
        'Öffne am Fernseher einen neuen QR-Code. Diese Seite braucht einen einmaligen Einrichtungslink.',
    'This setup link expired. Open a new QR code on the TV.':
        'Dieser Link ist abgelaufen. Öffne am Fernseher einen neuen QR-Code.',
    'This setup link is not valid.': 'Dieser Einrichtungslink ist ungültig.',
    'This link has already been used.': 'Dieser Link wurde schon benutzt.',
    'Invalid source.': 'Ungültige Quelle.',
    'TV settings · meddl': 'TV-Einstellungen · meddl',
    'Your TV. Your preferences.': 'Dein Fernseher. Deine Einstellungen.',
    'Adjust settings here, then confirm on your television.':
        'Passe die Einstellungen hier an und bestätige dann am Fernseher.',
    'Home layout': 'Startseite',
    'Show programme guide': 'Programmführer anzeigen',
    'Use TMDB metadata': 'TMDB-Infos verwenden',
    'TMDB API key or read access token': 'TMDB-API-Schlüssel oder Lese-Token',
    'Metadata language': 'Sprache der Infos',
    'Send settings to TV': 'Einstellungen an den Fernseher senden',
    'Changes apply only after confirmation on your TV. This link expires in five minutes. When enabled, title searches go directly from the TV to TMDB.':
        'Änderungen gelten erst nach Bestätigung am Fernseher. Der Link gilt fünf Minuten. Wenn aktiv, sucht der Fernseher Titel direkt bei TMDB.',
    'A key is already saved on the TV. Leave this field empty to keep it, or paste a replacement. The saved key is never sent to this phone.':
        'Auf dem Fernseher ist schon ein Schlüssel gespeichert. Lass das Feld leer, um ihn zu behalten, oder füge einen neuen ein. Der gespeicherte Schlüssel wird nie an dieses Handy gesendet.',
    'Paste your own TMDB v3 API key or v4 read access token.':
        'Füge deinen eigenen TMDB-v3-API-Schlüssel oder v4-Lese-Token ein.',
};

const german = typeof navigator !== 'undefined' && /^de\b/i.test(navigator.language || '');

export function tr(text: string): string {
    return (german && DE[text]) || text;
}

/** Translates the page's fixed texts (text, placeholders, title). */
export function translatePage(root: ParentNode = document) {
    if (!german) return;
    document.documentElement.lang = 'de';
    document.title = tr(document.title);
    const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    while (walker.nextNode()) texts.push(walker.currentNode as Text);
    for (const node of texts) {
        const key = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (key && DE[key]) node.textContent = DE[key];
    }
    // Headings split by <br>: translate the whole heading at once.
    root.querySelectorAll<HTMLElement>('h1').forEach((h) => {
        const key = (h.textContent ?? '').replace(/\s+/g, '');
        const joined = Object.keys(DE).find((k) => k.replace(/\s+/g, '') === key);
        if (joined) h.textContent = DE[joined];
    });
    root.querySelectorAll<HTMLInputElement>('[placeholder]').forEach((input) => {
        input.placeholder = tr(input.placeholder);
    });
}
