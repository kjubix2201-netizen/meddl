import { tr } from './i18n';
/**
 * Purpose 'vpn': a WireGuard profile for the TV's built-in VPN. The viewer
 * picks the .conf file downloaded from their VPN provider (or pastes it);
 * the text goes to the TV only, which keeps it in its private storage.
 */
export function vpnForm(form: HTMLFormElement) {
    document.title = tr('VPN profile · meddl');
    document.querySelector('h1')!.textContent = tr('A VPN for your TV.');
    document.querySelector('.intro')!.textContent = tr(
        'Choose the WireGuard file from your VPN provider (for example Proton VPN), then confirm on your television.'
    );
    form.innerHTML = `<label>${tr('WireGuard file (.conf)')}<input type="file" name="file" accept=".conf,text/plain,application/octet-stream"></label>
        <label>${tr('or paste its content')}<textarea name="config" rows="9" maxlength="8000" autocapitalize="none" spellcheck="false" placeholder="[Interface]
PrivateKey = …
Address = …

[Peer]
PublicKey = …
Endpoint = …"></textarea></label>
        <input type="hidden" name="name">
        <button type="submit">${tr('Send profile to TV')}</button>
        <p class="note">${tr('Only meddl on the TV uses this VPN; other apps stay as they are. The profile is saved on the TV after your confirmation. This link expires in five minutes.')}</p>`;
    const file = form.elements.namedItem('file') as HTMLInputElement;
    const config = form.elements.namedItem('config') as HTMLTextAreaElement;
    const name = form.elements.namedItem('name') as HTMLInputElement;
    config.required = true;
    file.onchange = async () => {
        const picked = file.files?.[0];
        if (!picked) return;
        config.value = (await picked.text()).slice(0, 8000);
        name.value = picked.name.replace(/\.conf$/i, '').slice(0, 60);
    };
}
