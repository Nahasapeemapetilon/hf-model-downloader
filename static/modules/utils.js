export function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function formatBytes(bytes, decimals = 1) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export function getFileTypeInfo(filename) {
    const ext = (filename.split('.').pop() || '').toLowerCase();
    const map = {
        'safetensors': { label: 'ST',   cls: 'ft-safetensors' },
        'bin':         { label: 'BIN',  cls: 'ft-bin'         },
        'gguf':        { label: 'GGUF', cls: 'ft-gguf'        },
        'json':        { label: 'JSON', cls: 'ft-json'        },
        'txt':         { label: 'TXT',  cls: 'ft-txt'         },
        'md':          { label: 'MD',   cls: 'ft-md'          },
        'py':          { label: 'PY',   cls: 'ft-json'        },
        'yaml':        { label: 'YML',  cls: 'ft-json'        },
        'yml':         { label: 'YML',  cls: 'ft-json'        },
        'pt':          { label: 'PT',   cls: 'ft-bin'         },
        'pth':         { label: 'PTH',  cls: 'ft-bin'         },
    };
    const info = map[ext];
    if (info) return info;
    const short = ext.substring(0, 4).toUpperCase() || '?';
    return { label: short, cls: 'ft-default' };
}

export function getSizeBadgeClass(bytes) {
    if (bytes < 100 * 1024 * 1024)  return 'size-small';
    if (bytes < 1024 * 1024 * 1024) return 'size-medium';
    return 'size-large';
}
