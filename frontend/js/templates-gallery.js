// ── Built-in Email Signature Template Gallery (22 fixed-width templates) ────
// All templates use fixed-pixel email-safe table layouts (480px–540px) and
// inline styles so they render consistently in Gmail, Outlook, and Apple Mail.

window.SIGNATURE_GALLERY = [
  {
    id: 'gal-classic-bar',
    name: 'Classic Left Accent',
    category: 'Corporate',
    desc: 'Clean vertical blue accent bar with structured contact details.',
    html: `<table cellpadding="0" cellspacing="0" border="0" width="520" style="width:520px;max-width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.45;color:#1e293b;">
  <tr>
    <td style="width:4px;background-color:#2563eb;padding:0;"></td>
    <td style="padding:2px 0 2px 14px;">
      <div style="font-size:16px;font-weight:700;color:#0f172a;">{{name}}</div>
      <div style="font-size:13px;color:#2563eb;font-weight:600;margin-bottom:6px;">{{title}} &middot; {{department}}</div>
      <div style="font-size:12px;color:#475569;">{{company}}</div>
      <div style="font-size:12px;color:#475569;margin-top:4px;">
        <a href="mailto:{{email}}" style="color:#2563eb;text-decoration:none;">{{email}}</a> &nbsp;|&nbsp; {{phone}}
      </div>
    </td>
  </tr>
</table>`
  },
  {
    id: 'gal-photo-left',
    name: 'Executive Photo Left',
    category: 'With Photo',
    desc: 'Circular avatar on the left with clean two-tier contact block.',
    html: `<table cellpadding="0" cellspacing="0" border="0" width="520" style="width:520px;max-width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.45;color:#1e293b;">
  <tr>
    <td valign="top" style="width:84px;padding:0 14px 0 0;">
      <img src="{{photoUrl}}" alt="{{name}}" width="72" height="72" style="width:72px;height:72px;border-radius:50%;object-fit:cover;display:block;border:2px solid #e2e8f0;">
    </td>
    <td valign="top" style="border-left:1px solid #cbd5e1;padding:0 0 0 14px;">
      <div style="font-size:16px;font-weight:700;color:#0f172a;">{{name}}</div>
      <div style="font-size:13px;color:#475569;margin-bottom:6px;">{{title}}, {{company}}</div>
      <div style="font-size:12px;color:#64748b;">
        E: <a href="mailto:{{email}}" style="color:#2563eb;text-decoration:none;">{{email}}</a><br>
        P: {{phone}}
      </div>
    </td>
  </tr>
</table>`
  },
  {
    id: 'gal-minimal-two-line',
    name: 'Minimalist Two-Line',
    category: 'Minimal',
    desc: 'Ultra-clean text-only signature for everyday correspondence.',
    html: `<table cellpadding="0" cellspacing="0" border="0" width="480" style="width:480px;max-width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#334155;">
  <tr>
    <td style="padding:0;">
      <strong style="font-size:14px;color:#0f172a;">{{name}}</strong> &mdash; {{title}}, {{company}}<br>
      <a href="mailto:{{email}}" style="color:#2563eb;text-decoration:none;">{{email}}</a> &middot; {{phone}}
    </td>
  </tr>
</table>`
  },
  {
    id: 'gal-modern-card',
    name: 'Modern Card Bordered',
    category: 'Accent',
    desc: 'Subtle rounded card frame with light background tint.',
    html: `<table cellpadding="0" cellspacing="0" border="0" width="520" style="width:520px;max-width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.45;color:#1e293b;background-color:#f8fafc;border:1px solid #e2e8f0;">
  <tr>
    <td style="padding:14px 16px;">
      <div style="font-size:15px;font-weight:700;color:#0f172a;">{{name}}</div>
      <div style="font-size:12px;color:#64748b;margin-bottom:8px;">{{title}} &bull; {{department}} &bull; {{company}}</div>
      <div style="font-size:12px;color:#334155;">
        <a href="mailto:{{email}}" style="color:#2563eb;text-decoration:none;">{{email}}</a> &nbsp;&bull;&nbsp; {{phone}}
      </div>
    </td>
  </tr>
</table>`
  },
  {
    id: 'gal-corp-top-rule',
    name: 'Corporate Top Rule',
    category: 'Corporate',
    desc: 'Top navy divider bar with balanced two-column footer.',
    html: `<table cellpadding="0" cellspacing="0" border="0" width="520" style="width:520px;max-width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.45;color:#1e293b;">
  <tr>
    <td colspan="2" style="border-top:3px solid #1e3a8a;padding-top:10px;">
      <div style="font-size:16px;font-weight:700;color:#1e3a8a;">{{name}}</div>
      <div style="font-size:13px;color:#475569;margin-bottom:8px;">{{title}} | {{department}} | {{company}}</div>
    </td>
  </tr>
  <tr>
    <td style="width:260px;font-size:12px;color:#475569;padding:0;">
      Email: <a href="mailto:{{email}}" style="color:#1e3a8a;text-decoration:none;">{{email}}</a>
    </td>
    <td style="width:260px;font-size:12px;color:#475569;padding:0;">
      Phone: {{phone}}
    </td>
  </tr>
</table>`
  },
  {
    id: 'gal-compact-inline',
    name: 'Compact Inline',
    category: 'Minimal',
    desc: 'Single-row compact signature with vertical pipe separators.',
    html: `<table cellpadding="0" cellspacing="0" border="0" width="500" style="width:500px;max-width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.45;color:#475569;">
  <tr>
    <td style="border-top:1px solid #e2e8f0;padding-top:8px;">
      <strong style="color:#0f172a;font-size:13px;">{{name}}</strong> &nbsp;|&nbsp; {{title}} &nbsp;|&nbsp; {{company}}<br>
      <a href="mailto:{{email}}" style="color:#2563eb;text-decoration:none;">{{email}}</a> &nbsp;|&nbsp; {{phone}}
    </td>
  </tr>
</table>`
  },
  {
    id: 'gal-photo-square',
    name: 'Rounded Square Photo',
    category: 'With Photo',
    desc: 'Soft-cornered 64px photo paired with stacked details.',
    html: `<table cellpadding="0" cellspacing="0" border="0" width="500" style="width:500px;max-width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.45;color:#1e293b;">
  <tr>
    <td valign="middle" style="width:78px;padding:0 14px 0 0;">
      <img src="{{photoUrl}}" alt="{{name}}" width="64" height="64" style="width:64px;height:64px;border-radius:10px;object-fit:cover;display:block;">
    </td>
    <td valign="middle" style="padding:0;">
      <div style="font-size:15px;font-weight:700;color:#0f172a;">{{name}}</div>
      <div style="font-size:12px;color:#64748b;">{{title}} &mdash; {{department}}</div>
      <div style="font-size:12px;color:#334155;margin-top:4px;">
        <strong>{{company}}</strong> &middot; <a href="mailto:{{email}}" style="color:#2563eb;text-decoration:none;">{{email}}</a> &middot; {{phone}}
      </div>
    </td>
  </tr>
</table>`
  },
  {
    id: 'gal-bold-role',
    name: 'Bold Name & Subtle Role',
    category: 'Minimal',
    desc: 'High-contrast typography with generous breathing room.',
    html: `<table cellpadding="0" cellspacing="0" border="0" width="480" style="width:480px;max-width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#1e293b;">
  <tr>
    <td style="padding:0;">
      <div style="font-size:18px;font-weight:700;letter-spacing:-0.01em;color:#0f172a;">{{name}}</div>
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.06em;color:#64748b;margin-bottom:8px;">{{title}} &bull; {{company}}</div>
      <div style="font-size:12px;color:#334155;">
        <a href="mailto:{{email}}" style="color:#0f172a;text-decoration:underline;">{{email}}</a> &nbsp;&nbsp; {{phone}}
      </div>
    </td>
  </tr>
</table>`
  },
  {
    id: 'gal-two-col-split',
    name: 'Two-Column Contact Split',
    category: 'Corporate',
    desc: 'Identity on the left, direct contact details on the right.',
    html: `<table cellpadding="0" cellspacing="0" border="0" width="540" style="width:540px;max-width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.45;color:#1e293b;">
  <tr>
    <td valign="top" style="width:260px;padding:0 16px 0 0;border-right:1px solid #cbd5e1;">
      <div style="font-size:16px;font-weight:700;color:#0f172a;">{{name}}</div>
      <div style="font-size:13px;color:#475569;">{{title}}</div>
      <div style="font-size:12px;color:#64748b;margin-top:2px;">{{department}}</div>
    </td>
    <td valign="top" style="width:260px;padding:0 0 0 16px;font-size:12px;color:#475569;">
      <div style="font-weight:700;color:#0f172a;margin-bottom:2px;">{{company}}</div>
      <div><a href="mailto:{{email}}" style="color:#2563eb;text-decoration:none;">{{email}}</a></div>
      <div>{{phone}}</div>
    </td>
  </tr>
</table>`
  },
  {
    id: 'gal-slate-header',
    name: 'Dark Slate Header Strip',
    category: 'Accent',
    desc: 'Dark slate name banner with crisp white contact body.',
    html: `<table cellpadding="0" cellspacing="0" border="0" width="520" style="width:520px;max-width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.45;border:1px solid #cbd5e1;">
  <tr>
    <td style="background-color:#0f172a;color:#ffffff;padding:10px 14px;">
      <div style="font-size:15px;font-weight:700;">{{name}}</div>
      <div style="font-size:12px;color:#cbd5e1;">{{title}} &middot; {{company}}</div>
    </td>
  </tr>
  <tr>
    <td style="background-color:#ffffff;color:#334155;padding:10px 14px;font-size:12px;">
      <a href="mailto:{{email}}" style="color:#2563eb;text-decoration:none;">{{email}}</a> &nbsp;|&nbsp; {{phone}} &nbsp;|&nbsp; {{department}}
    </td>
  </tr>
</table>`
  },
  {
    id: 'gal-tech-mono',
    name: 'Engineering / Tech Clean',
    category: 'Minimal',
    desc: 'Monospace role badge with clean contact links.',
    html: `<table cellpadding="0" cellspacing="0" border="0" width="500" style="width:500px;max-width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.45;color:#1e293b;">
  <tr>
    <td style="padding:0;">
      <div style="font-size:15px;font-weight:700;color:#0f172a;">{{name}}</div>
      <div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:#2563eb;margin:2px 0 6px;">{{title}} // {{department}}</div>
      <div style="font-size:12px;color:#475569;">
        {{company}} &middot; <a href="mailto:{{email}}" style="color:#2563eb;text-decoration:none;">{{email}}</a> &middot; {{phone}}
      </div>
    </td>
  </tr>
</table>`
  },
  {
    id: 'gal-sales-cta',
    name: 'Sales & Outreach Banner',
    category: 'Accent',
    desc: 'Photo signature with a subtle bottom company bar.',
    html: `<table cellpadding="0" cellspacing="0" border="0" width="520" style="width:520px;max-width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.45;color:#1e293b;">
  <tr>
    <td valign="top" style="width:76px;padding:0 12px 10px 0;">
      <img src="{{photoUrl}}" alt="{{name}}" width="64" height="64" style="width:64px;height:64px;border-radius:50%;object-fit:cover;display:block;">
    </td>
    <td valign="top" style="padding:0 0 10px 0;">
      <div style="font-size:15px;font-weight:700;color:#0f172a;">{{name}}</div>
      <div style="font-size:12px;color:#475569;margin-bottom:4px;">{{title}} &middot; {{company}}</div>
      <div style="font-size:12px;">
        <a href="mailto:{{email}}" style="color:#2563eb;text-decoration:none;">{{email}}</a> &nbsp;|&nbsp; {{phone}}
      </div>
    </td>
  </tr>
  <tr>
    <td colspan="2" style="background-color:#eff6ff;color:#1d4ed8;padding:6px 10px;font-size:11px;font-weight:600;border-left:3px solid #2563eb;">
      {{department}} &mdash; {{company}}
    </td>
  </tr>
</table>`
  },
  {
    id: 'gal-support-clean',
    name: 'Support Team Clean',
    category: 'Corporate',
    desc: 'Friendly, scannable layout tailored for support teams.',
    html: `<table cellpadding="0" cellspacing="0" border="0" width="500" style="width:500px;max-width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.45;color:#1e293b;">
  <tr>
    <td style="border-left:3px solid #0ea5e9;padding-left:12px;">
      <div style="font-size:15px;font-weight:700;color:#0f172a;">{{name}}</div>
      <div style="font-size:12px;color:#0284c7;font-weight:600;">{{department}} &mdash; {{company}}</div>
      <div style="font-size:12px;color:#475569;margin-top:4px;">
        <a href="mailto:{{email}}" style="color:#0284c7;text-decoration:none;">{{email}}</a> &bull; {{phone}}
      </div>
    </td>
  </tr>
</table>`
  },
  {
    id: 'gal-legal-footer',
    name: 'Corporate + Confidentiality Note',
    category: 'Corporate',
    desc: 'Standard signature with a compact confidentiality disclaimer.',
    html: `<table cellpadding="0" cellspacing="0" border="0" width="540" style="width:540px;max-width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.45;color:#1e293b;">
  <tr>
    <td style="padding-bottom:10px;border-bottom:1px solid #e2e8f0;">
      <div style="font-size:15px;font-weight:700;color:#0f172a;">{{name}}</div>
      <div style="font-size:12px;color:#475569;">{{title}}, {{department}} &bull; {{company}}</div>
      <div style="font-size:12px;color:#475569;margin-top:4px;">
        <a href="mailto:{{email}}" style="color:#2563eb;text-decoration:none;">{{email}}</a> &nbsp;|&nbsp; {{phone}}
      </div>
    </td>
  </tr>
  <tr>
    <td style="padding-top:8px;font-size:10px;line-height:1.4;color:#94a3b8;">
      This email and any attachments are confidential and intended solely for the addressee.
    </td>
  </tr>
</table>`
  },
  {
    id: 'gal-emerald-photo',
    name: 'Emerald Accent Photo',
    category: 'With Photo',
    desc: 'Circular photo with emerald green accent bar.',
    html: `<table cellpadding="0" cellspacing="0" border="0" width="520" style="width:520px;max-width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.45;color:#1e293b;">
  <tr>
    <td valign="middle" style="width:82px;padding:0 12px 0 0;">
      <img src="{{photoUrl}}" alt="{{name}}" width="68" height="68" style="width:68px;height:68px;border-radius:50%;object-fit:cover;display:block;border:2px solid #10b981;">
    </td>
    <td valign="middle" style="border-left:3px solid #10b981;padding-left:12px;">
      <div style="font-size:16px;font-weight:700;color:#0f172a;">{{name}}</div>
      <div style="font-size:12px;color:#059669;font-weight:600;">{{title}} &middot; {{company}}</div>
      <div style="font-size:12px;color:#475569;margin-top:4px;">
        <a href="mailto:{{email}}" style="color:#059669;text-decoration:none;">{{email}}</a> &nbsp;|&nbsp; {{phone}}
      </div>
    </td>
  </tr>
</table>`
  },
  {
    id: 'gal-amber-accent',
    name: 'Warm Amber Accent',
    category: 'Accent',
    desc: 'Warm gold/amber left bar for creative and marketing teams.',
    html: `<table cellpadding="0" cellspacing="0" border="0" width="500" style="width:500px;max-width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.45;color:#1e293b;">
  <tr>
    <td style="width:4px;background-color:#d97706;padding:0;"></td>
    <td style="padding:2px 0 2px 14px;">
      <div style="font-size:16px;font-weight:700;color:#0f172a;">{{name}}</div>
      <div style="font-size:12px;color:#b45309;font-weight:600;">{{title}} &bull; {{department}}</div>
      <div style="font-size:12px;color:#475569;margin-top:4px;">
        {{company}} &nbsp;|&nbsp; <a href="mailto:{{email}}" style="color:#b45309;text-decoration:none;">{{email}}</a> &nbsp;|&nbsp; {{phone}}
      </div>
    </td>
  </tr>
</table>`
  },
  {
    id: 'gal-centered-clean',
    name: 'Centered Minimal Card',
    category: 'Minimal',
    desc: 'Centered name, role, and contact block in a 480px frame.',
    html: `<table cellpadding="0" cellspacing="0" border="0" width="480" style="width:480px;max-width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.45;color:#1e293b;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">
  <tr>
    <td align="center" style="padding:12px 8px;">
      <div style="font-size:15px;font-weight:700;color:#0f172a;">{{name}}</div>
      <div style="font-size:12px;color:#64748b;">{{title}} &middot; {{company}}</div>
      <div style="font-size:12px;color:#334155;margin-top:4px;">
        <a href="mailto:{{email}}" style="color:#2563eb;text-decoration:none;">{{email}}</a> &nbsp;&bull;&nbsp; {{phone}}
      </div>
    </td>
  </tr>
</table>`
  },
  {
    id: 'gal-photo-right',
    name: 'Photo Right Balanced',
    category: 'With Photo',
    desc: 'Contact details on the left, circular photo aligned right.',
    html: `<table cellpadding="0" cellspacing="0" border="0" width="520" style="width:520px;max-width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.45;color:#1e293b;">
  <tr>
    <td valign="middle" style="padding:0 16px 0 0;">
      <div style="font-size:16px;font-weight:700;color:#0f172a;">{{name}}</div>
      <div style="font-size:12px;color:#2563eb;font-weight:600;margin-bottom:6px;">{{title}} &middot; {{department}}</div>
      <div style="font-size:12px;color:#475569;">
        {{company}}<br>
        <a href="mailto:{{email}}" style="color:#2563eb;text-decoration:none;">{{email}}</a> &nbsp;|&nbsp; {{phone}}
      </div>
    </td>
    <td valign="middle" align="right" style="width:80px;padding:0;">
      <img src="{{photoUrl}}" alt="{{name}}" width="68" height="68" style="width:68px;height:68px;border-radius:50%;object-fit:cover;display:block;border:1px solid #cbd5e1;">
    </td>
  </tr>
</table>`
  },
  {
    id: 'gal-dualtone-bar',
    name: 'Dual-Tone Split Bar',
    category: 'Accent',
    desc: 'Indigo accent stripe with clean two-row contact details.',
    html: `<table cellpadding="0" cellspacing="0" border="0" width="520" style="width:520px;max-width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.45;color:#1e293b;">
  <tr>
    <td style="width:5px;background-color:#4f46e5;padding:0;"></td>
    <td style="padding:4px 0 4px 14px;">
      <div style="font-size:16px;font-weight:700;color:#0f172a;">{{name}}</div>
      <div style="font-size:12px;color:#4f46e5;font-weight:600;margin-bottom:6px;">{{title}} &mdash; {{company}}</div>
      <div style="font-size:12px;color:#475569;">
        <strong>Email:</strong> <a href="mailto:{{email}}" style="color:#4f46e5;text-decoration:none;">{{email}}</a><br>
        <strong>Phone:</strong> {{phone}}
      </div>
    </td>
  </tr>
</table>`
  },
  {
    id: 'gal-founder-clean',
    name: 'Leadership & Founder',
    category: 'With Photo',
    desc: 'Refined serif-accented name with rounded photo and subtle divider.',
    html: `<table cellpadding="0" cellspacing="0" border="0" width="520" style="width:520px;max-width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.45;color:#1e293b;">
  <tr>
    <td valign="top" style="width:80px;padding:0 14px 0 0;">
      <img src="{{photoUrl}}" alt="{{name}}" width="68" height="68" style="width:68px;height:68px;border-radius:12px;object-fit:cover;display:block;">
    </td>
    <td valign="top" style="padding:0;">
      <div style="font-family:Georgia,serif;font-size:17px;font-weight:700;color:#0f172a;">{{name}}</div>
      <div style="font-size:12px;color:#64748b;margin-bottom:6px;">{{title}}, {{company}}</div>
      <div style="border-top:1px solid #e2e8f0;padding-top:6px;font-size:12px;color:#334155;">
        <a href="mailto:{{email}}" style="color:#0f172a;text-decoration:none;">{{email}}</a> &nbsp;&middot;&nbsp; {{phone}}
      </div>
    </td>
  </tr>
</table>`
  },
  {
    id: 'gal-dept-direct',
    name: 'Department & Direct Line',
    category: 'Corporate',
    desc: 'Structured 520px corporate table with labeled fields.',
    html: `<table cellpadding="0" cellspacing="0" border="0" width="520" style="width:520px;max-width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#334155;">
  <tr>
    <td colspan="2" style="padding-bottom:6px;border-bottom:2px solid #0f172a;">
      <span style="font-size:15px;font-weight:700;color:#0f172a;">{{name}}</span>
      <span style="color:#64748b;"> &mdash; {{title}}</span>
    </td>
  </tr>
  <tr>
    <td style="width:90px;padding-top:6px;color:#64748b;font-weight:600;">Department</td>
    <td style="padding-top:6px;">{{department}} &middot; {{company}}</td>
  </tr>
  <tr>
    <td style="width:90px;color:#64748b;font-weight:600;">Email</td>
    <td><a href="mailto:{{email}}" style="color:#2563eb;text-decoration:none;">{{email}}</a></td>
  </tr>
  <tr>
    <td style="width:90px;color:#64748b;font-weight:600;">Direct</td>
    <td>{{phone}}</td>
  </tr>
</table>`
  },
  {
    id: 'gal-pill-badge',
    name: 'Department Pill Badge',
    category: 'Accent',
    desc: 'Clean signature with a soft pill badge for team or department.',
    html: `<table cellpadding="0" cellspacing="0" border="0" width="500" style="width:500px;max-width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.45;color:#1e293b;">
  <tr>
    <td style="padding:0;">
      <div style="font-size:16px;font-weight:700;color:#0f172a;">{{name}}</div>
      <div style="margin:3px 0 8px;">
        <span style="display:inline-block;background-color:#eff6ff;color:#1d4ed8;font-size:11px;font-weight:600;padding:2px 8px;border-radius:12px;">{{department}}</span>
        <span style="font-size:12px;color:#64748b;margin-left:6px;">{{title}} at {{company}}</span>
      </div>
      <div style="font-size:12px;color:#475569;">
        <a href="mailto:{{email}}" style="color:#2563eb;text-decoration:none;">{{email}}</a> &nbsp;&bull;&nbsp; {{phone}}
      </div>
    </td>
  </tr>
</table>`
  }
];

// ── Template Gallery & Saved Templates Modal ─────────────────────────────────

window._galleryState = { target: 'bulk', tab: 'gallery', category: 'All', query: '', selectedId: null };

function openTemplateGallery(target, initialTab) {
  window._galleryState = {
    target: target || 'bulk',
    tab: initialTab || 'gallery',
    category: 'All',
    query: '',
    selectedId: null
  };
  renderTemplateGalleryModal();
  document.getElementById('template-gallery-overlay')?.classList.remove('hidden');
}

function closeTemplateGallery() {
  document.getElementById('template-gallery-overlay')?.classList.add('hidden');
}

function setGalleryTab(tab) {
  window._galleryState.tab = tab;
  window._galleryState.selectedId = null;
  renderTemplateGalleryModal();
}

function setGalleryCategory(cat) {
  window._galleryState.category = cat;
  renderTemplateGalleryModal();
}

function setGalleryQuery(q) {
  window._galleryState.query = q || '';
  renderTemplateGalleryCards();
}

function selectGalleryTemplate(id) {
  window._galleryState.selectedId = id;
  renderTemplateGalleryCards();
  renderGalleryPreviewPane();
}

function useGalleryTemplate(id) {
  var st = window._galleryState;
  var item = _findGalleryOrSaved(id);
  if (!item) return;

  var ed = null;
  if (st.target === 'sig') ed = window._sigEd;
  else if (st.target === 'bulk') ed = window._bulkEditor;
  else if (st.target === 'schedule') ed = window._scheduleEditor;

  if (!ed) {
    notify('Editor is not ready yet — try again in a moment', 'warning');
    return;
  }

  setEditorHtml(ed, cleanHtmlString(item.html || ''));
  if (st.target === 'schedule' && typeof updateScheduleSourceNote === 'function') {
    var sel = document.getElementById('sch-template');
    if (sel) sel.value = (st.tab === 'saved') ? item.id : '';
    var live = document.getElementById('sch-template-live');
    if (live && st.tab === 'gallery') {
      live.checked = false;
      if (typeof onScheduleTemplateLiveChange === 'function') onScheduleTemplateLiveChange();
    }
    updateScheduleSourceNote();
  }
  closeTemplateGallery();
  notify('Inserted “' + item.name + '” into editor', 'success');
}

function _findGalleryOrSaved(id) {
  var st = window._galleryState;
  if (st.tab === 'saved') {
    return (window._loadedTemplates || []).find(function(x) { return x.id === id; }) || null;
  }
  return (window.SIGNATURE_GALLERY || []).find(function(x) { return x.id === id; }) || null;
}

function renderTemplateGalleryModal() {
  var box = document.getElementById('template-gallery-box');
  if (!box) return;
  var st = window._galleryState;
  var cats = ['All', 'With Photo', 'Minimal', 'Corporate', 'Accent'];
  var savedCount = (window._loadedTemplates || []).length;

  box.innerHTML = `
    <div class="flex items-start justify-between gap-4 mb-4">
      <div>
        <h3 class="font-bold text-lg">Signature Templates</h3>
        <p class="text-xs opacity-60">Pick a template to preview and insert into the editor, then customize as needed.</p>
      </div>
      <button class="btn btn-sm btn-ghost" onclick="closeTemplateGallery()">✕</button>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div class="tabs tabs-boxed tabs-sm bg-base-200 p-1 rounded-lg">
        <a class="tab ${st.tab === 'gallery' ? 'tab-active' : ''}" onclick="setGalleryTab('gallery')">Gallery (${window.SIGNATURE_GALLERY.length})</a>
        <a class="tab ${st.tab === 'saved' ? 'tab-active' : ''}" onclick="setGalleryTab('saved')">Saved Templates (${savedCount})</a>
      </div>
      <input id="gal-search" type="text" class="input input-bordered input-sm w-56" placeholder="Filter templates..."
             value="${esc(st.query)}" oninput="setGalleryQuery(this.value)">
    </div>

    ${st.tab === 'gallery' ? `
      <div class="flex flex-wrap gap-1.5 mb-4">
        ${cats.map(c => `<button type="button" class="btn btn-xs ${st.category === c ? 'btn-primary' : 'btn-outline'}" onclick="setGalleryCategory('${c}')">${c}</button>`).join('')}
      </div>
    ` : ''}

    <div class="grid grid-cols-1 lg:grid-cols-12 gap-4">
      <div id="gal-cards" class="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[55vh] overflow-y-auto pr-1"></div>
      <div id="gal-preview-pane" class="lg:col-span-5 border border-base-300 rounded-xl p-4 bg-base-200/40 flex flex-col justify-between min-h-[260px]"></div>
    </div>
  `;

  renderTemplateGalleryCards();
  renderGalleryPreviewPane();
}

function renderTemplateGalleryCards() {
  var wrap = document.getElementById('gal-cards');
  if (!wrap) return;
  var st = window._galleryState;
  var q = (st.query || '').trim().toLowerCase();

  var list = st.tab === 'saved'
    ? (window._loadedTemplates || []).map(t => ({ id: t.id, name: t.name, category: 'Saved', desc: 'Custom saved template', html: t.html || '' }))
    : window.SIGNATURE_GALLERY;

  list = list.filter(function(t) {
    if (st.tab === 'gallery' && st.category !== 'All' && t.category !== st.category) return false;
    if (q && t.name.toLowerCase().indexOf(q) === -1 && (t.desc || '').toLowerCase().indexOf(q) === -1 && (t.category || '').toLowerCase().indexOf(q) === -1) return false;
    return true;
  });

  if (!list.length) {
    wrap.innerHTML = `<div class="col-span-full text-center py-10 text-sm opacity-60">${st.tab === 'saved' ? 'No custom templates saved yet.' : 'No templates match your filter.'}</div>`;
    return;
  }

  if (!st.selectedId || !list.some(x => x.id === st.selectedId)) {
    st.selectedId = list[0].id;
  }

  wrap.innerHTML = list.map(function(t) {
    var active = t.id === st.selectedId;
    var previewHtml = cleanHtmlString(t.html || '');
    return `
      <div class="border rounded-xl p-3 cursor-pointer transition-colors bg-base-100 ${active ? 'border-primary ring-2 ring-primary/20' : 'border-base-300 hover:border-primary/50'}"
           onclick="selectGalleryTemplate('${esc(t.id)}')">
        <div class="flex items-center justify-between gap-2 mb-2">
          <span class="font-semibold text-xs truncate">${esc(t.name)}</span>
          <span class="badge badge-ghost badge-xs shrink-0">${esc(t.category || 'Custom')}</span>
        </div>
        <div class="bg-white text-slate-800 border border-slate-200 rounded-lg p-2.5 h-24 overflow-hidden pointer-events-none">
          <div style="transform:scale(0.55);transform-origin:top left;width:540px;">${previewHtml}</div>
        </div>
      </div>
    `;
  }).join('');
}

function renderGalleryPreviewPane() {
  var pane = document.getElementById('gal-preview-pane');
  if (!pane) return;
  var st = window._galleryState;
  var item = st.selectedId ? _findGalleryOrSaved(st.selectedId) : null;
  if (!item) {
    pane.innerHTML = '<div class="text-xs opacity-60 m-auto">Select a template to preview</div>';
    return;
  }

  var previewHtml = cleanHtmlString(item.html || '');
  pane.innerHTML = `
    <div>
      <div class="flex items-center justify-between gap-2 mb-1">
        <h4 class="font-bold text-sm">${esc(item.name)}</h4>
        <span class="badge badge-ghost badge-xs">${esc(item.category || 'Saved')}</span>
      </div>
      <p class="text-xs opacity-60 mb-3">${esc(item.desc || 'Custom saved template')}</p>
      <div class="bg-white text-slate-800 border border-slate-200 rounded-lg p-4 overflow-x-auto shadow-sm">
        ${previewHtml || '<span class="text-xs text-slate-400">Empty template</span>'}
      </div>
    </div>
    <div class="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-base-300">
      ${st.tab === 'saved'
        ? `<button type="button" class="btn btn-xs btn-error btn-outline" onclick="deleteGallerySaved('${esc(item.id)}','${esc(item.name)}')">Delete</button>`
        : '<span class="text-xs opacity-60">Fixed-width 480–540px email layout</span>'}
      <button type="button" class="btn btn-sm btn-primary" onclick="useGalleryTemplate('${esc(item.id)}')">Insert Template</button>
    </div>
  `;
}

async function deleteGallerySaved(id, name) {
  if (typeof deleteTemplate === 'function') {
    await deleteTemplate(id, name);
    window._galleryState.selectedId = null;
    renderTemplateGalleryModal();
  }
}
