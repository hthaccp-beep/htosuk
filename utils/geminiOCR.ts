import { auth } from '../firebase-config.ts';

export async function extractReceiptQuantities(
    file: File, 
    orderItems: any, 
    manualItems: any[] = [],
    orderId?: string,
    branchId?: string
) {
    if (auth && !auth.currentUser) {
        try {
            if (typeof (auth as any).authStateReady === 'function') {
                await (auth as any).authStateReady();
            } else {
                await new Promise<void>((resolve) => {
                    const unsub = auth.onAuthStateChanged(() => {
                        unsub();
                        resolve();
                    });
                    setTimeout(resolve, 2000);
                });
            }
        } catch (_) {}
    }

    let token: string | undefined;
    try {
        token = await auth?.currentUser?.getIdToken(true);
    } catch (_) {
        token = await auth?.currentUser?.getIdToken();
    }

    if (!token) {
        throw new Error('Please sign in to scan documents.');
    }

    const base64str = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const res = reader.result as string;
            const base64 = res.split(',')[1] || '';
            resolve(base64);
        };
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(file);
    });

    let itemsList = '';
    if (typeof orderItems === 'string') {
        itemsList = orderItems;
    } else if (Array.isArray(orderItems)) {
        const stdNames = orderItems.map(i => typeof i === 'string' ? i : i.productNameSnapshot || i.name || '');
        const manualNames = Array.isArray(manualItems) ? manualItems.map(i => typeof i === 'string' ? i : i.description || '') : [];
        itemsList = [...stdNames, ...manualNames].filter(Boolean).join(", ");
    }

    // Determine canonical MIME type
    const lowerName = file.name.toLowerCase();
    let mimeType = file.type || '';
    if (lowerName.endsWith('.pdf') || mimeType === 'application/pdf') {
        mimeType = 'application/pdf';
    } else if (lowerName.endsWith('.png') || mimeType === 'image/png') {
        mimeType = 'image/png';
    } else if (lowerName.endsWith('.webp') || mimeType === 'image/webp') {
        mimeType = 'image/webp';
    } else {
        mimeType = 'image/jpeg';
    }

    const clientRequestId = `ocr_cli_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    let response = await fetch('/api/ocr', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'X-Request-Id': clientRequestId,
        },
        body: JSON.stringify({ base64str, mimeType, itemsList, orderId, branchId })
    });

    if (response.status === 401 && auth?.currentUser) {
        try {
            token = await auth.currentUser.getIdToken(true);
            response = await fetch('/api/ocr', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-Request-Id': clientRequestId,
                },
                body: JSON.stringify({ base64str, mimeType, itemsList, orderId, branchId })
            });
        } catch (_) {}
    }

    if (!response.ok) {
        const reqId = response.headers.get('x-request-id') || clientRequestId;
        let errorMessage = `Server error (${response.status} ${response.statusText || 'Error'})`;
        let errorCode: string | undefined = undefined;

        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            try {
                const data = await response.json();
                errorMessage = data.error || errorMessage;
                errorCode = data.code;
            } catch (_) {}
        } else {
            try {
                const rawText = await response.text();
                // Strip HTML tags if server returned an HTML error page (e.g. 500/502/504)
                const cleanText = rawText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                if (cleanText) {
                    errorMessage = `${errorMessage}: ${cleanText.slice(0, 180)}`;
                }
            } catch (_) {}
        }

        // Redact any tokens or keys in error message
        errorMessage = errorMessage
            .replace(/AIza[0-9A-Za-z-_]{35}/g, '[REDACTED_KEY]')
            .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]');

        const fullMsg = reqId ? `${errorMessage} (Request ID: ${reqId})` : errorMessage;
        const err = new Error(fullMsg);
        (err as any).status = response.status;
        (err as any).code = errorCode;
        (err as any).requestId = reqId;
        throw err;
    }
    
    return await response.json();
}
