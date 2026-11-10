import { useState, useCallback } from 'react';
import { useAppStore } from '../../../store';
import { Category, Product } from '../../../types';

interface UsePrintChecklistParams {
  sortedCategories: Category[];
  groupedProducts: Record<string, Product[]>;
  activeSupplierName: string;
}

export const usePrintChecklist = ({
  sortedCategories,
  groupedProducts,
  activeSupplierName,
}: UsePrintChecklistParams) => {
  const { showToast } = useAppStore();
  const [isGenerating, setIsGenerating] = useState(false);

  const handlePrint = useCallback(() => {
    setIsGenerating(true);

    // 1. Flatten Data for Layout Calculation
    const gridItems: Array<{ type: 'cat'; name: string } | { type: 'prod'; product: Product; index: number }> = [];
    let globalIndex = 1;

    sortedCategories.forEach(cat => {
      const prods = groupedProducts[cat.id];
      if (prods && prods.length > 0) {
        gridItems.push({ type: 'cat', name: cat.name });
        prods.forEach(p => {
          gridItems.push({ type: 'prod', product: p, index: globalIndex++ });
        });
      }
    });

    if (gridItems.length === 0) {
      showToast('error', 'No products available for checklist.');
      setIsGenerating(false);
      return;
    }

    // 2. Calculate Optimal Layout (Columns & Copies)
    const layout = calculateOptimalLayout(gridItems);

    // 3. Create Iframe
    const iframeId = `checklist-frame-${Date.now()}`;
    let iframe = document.getElementById(iframeId) as HTMLIFrameElement;
    if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = iframeId;
        iframe.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:-1;';
        document.body.appendChild(iframe);
    }

    const doc = iframe.contentWindow?.document;
    if (!doc) {
      setIsGenerating(false);
      showToast('error', 'Failed to create print document.');
      return;
    }

    // 4. Generate HTML
    const htmlContent = generateChecklistHTML(gridItems, activeSupplierName, layout);
    doc.open();
    doc.write(htmlContent);
    doc.close();

    // 5. Trigger Print
    setTimeout(() => {
      if (iframe.contentWindow) {
        iframe.contentWindow.focus();
        try {
          iframe.contentWindow.print();
        } catch (e) {
          console.error(e);
          showToast('error', 'Print failed.');
        }
      }
      setIsGenerating(false);
      // Clean up after delay
      setTimeout(() => {
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe);
        }
      }, 5000);
    }, 500);
  }, [sortedCategories, groupedProducts, activeSupplierName, showToast]);

  return {
    isGenerating,
    handlePrint,
  };
};

// --- CONSTANTS ---
// Metrics in mm (Must match CSS)
const PAGE_HEIGHT = 285; // Safe printable A4 height (297 - margins)
const HEADER_HEIGHT = 10;
const CAT_HEIGHT = 4.2;
const ROW_HEIGHT = 4.2;
const CUT_HEIGHT = 6;

// --- HELPER: Layout Engine ---
function calculateOptimalLayout(items: Array<{ type: 'cat' } | { type: 'prod' }>) {
  
  // Helper to get total height for a given column count
  const getHeight = (cols: number) => {
    let contentHeight = 0;
    let currentCatItems = 0;

    items.forEach(item => {
      if (item.type === 'cat') {
        if (currentCatItems > 0) {
          contentHeight += Math.ceil(currentCatItems / cols) * ROW_HEIGHT;
        }
        currentCatItems = 0;
        contentHeight += CAT_HEIGHT; 
      } else {
        currentCatItems++;
      }
    });
    if (currentCatItems > 0) {
      contentHeight += Math.ceil(currentCatItems / cols) * ROW_HEIGHT;
    }
    return HEADER_HEIGHT + contentHeight;
  };

  // 1. Try Standard 3-Column Layout
  const height3 = getHeight(3);
  if (height3 <= PAGE_HEIGHT) {
     const copies = Math.floor((PAGE_HEIGHT + CUT_HEIGHT) / (height3 + CUT_HEIGHT));
     return { columns: 3, copies: Math.max(1, copies) };
  }

  // 2. Try Compact 4-Column Layout (If 3 cols overflow)
  const height4 = getHeight(4);
  // Even if 4 cols still overflow (extremely rare), we default to 4 cols as it's the most dense we can go readable.
  // In that case, copies will be 1 (overflowing 1 page, but best effort).
  const copies4 = Math.floor((PAGE_HEIGHT + CUT_HEIGHT) / (height4 + CUT_HEIGHT));
  return { columns: 4, copies: Math.max(1, copies4) };
}

// --- HELPER: HTML Generation ---
function generateChecklistHTML(
  gridItems: Array<{ type: 'cat'; name: string } | { type: 'prod'; product: Product; index: number }>,
  supplierName: string,
  layout: { columns: number, copies: number }
): string {
  
  // 1. Build List HTML
  let listHtml = '';
  let currentCatBuffer: string[] = [];
  
  const flushBuffer = () => {
    if (currentCatBuffer.length === 0) return;
    
    let rowsHtml = '';
    // Dynamic Grid Loop
    for (let i = 0; i < currentCatBuffer.length; i += layout.columns) {
      rowsHtml += '<div class="row">';
      // Add cells for this row
      for (let j = 0; j < layout.columns; j++) {
         if (i + j < currentCatBuffer.length) {
            rowsHtml += currentCatBuffer[i + j];
         } else {
            rowsHtml += '<div class="item-cell empty"></div>';
         }
      }
      rowsHtml += '</div>';
    }
    listHtml += rowsHtml;
    currentCatBuffer = [];
  };

  gridItems.forEach(item => {
    if (item.type === 'cat') {
      flushBuffer();
      listHtml += `<div class="cat-header">${item.name}</div>`;
    } else {
      const p = item.product;
      const cellHtml = `
        <div class="item-cell">
          <div class="idx">${item.index}</div>
          <div class="text">
            <span class="en">${p.name}</span>
            ${p.chineseName ? `<span class="cn">${p.chineseName}</span>` : ''}
          </div>
          <div class="checks">
            <div class="box"></div>
            <div class="box"></div>
          </div>
        </div>
      `;
      currentCatBuffer.push(cellHtml);
    }
  });
  flushBuffer();

  // 2. Wrap Unit
  const unitHtml = `
    <div class="checklist-unit">
      <div class="main-header">${supplierName}</div>
      <div class="grid-body">
        ${listHtml}
      </div>
    </div>
  `;

  // 3. Repeat Units
  let bodyHtml = '';
  for (let i = 0; i < layout.copies; i++) {
    bodyHtml += unitHtml;
    if (i < layout.copies - 1) {
      bodyHtml += `<div class="cut-line"><div class="scissor">✂</div><div class="dash"></div></div>`;
    }
  }

  // Styles adjusted for density
  const fontSize = layout.columns === 4 ? '7pt' : '7.5pt';
  const idxWidth = layout.columns === 4 ? '4mm' : '5mm';
  const checksWidth = layout.columns === 4 ? '8mm' : '10mm';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>${supplierName} Checklist</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@400;600;700&display=swap');
        @media print {
          @page { size: A4 portrait; margin: 0; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
        
        * { box-sizing: border-box; }

        body { 
          font-family: 'Roboto Condensed', Arial, sans-serif; 
          margin: 5mm; 
          padding: 0; 
          background: #fff; color: #000;
          font-size: ${fontSize};
        }

        .checklist-unit {
          width: 100%;
          break-inside: avoid;
        }

        .main-header {
          text-align: center;
          font-weight: 900;
          font-size: 14pt;
          text-transform: uppercase;
          padding-bottom: 1mm;
          margin-bottom: 1mm;
          border-bottom: 2pt solid #000;
          line-height: 1;
          margin-top: 1mm;
          height: ${HEADER_HEIGHT}mm;
          display: flex;
          align-items: flex-end;
          justify-content: center;
          white-space: nowrap;
          overflow: hidden;
        }

        .grid-body {
          display: flex;
          flex-direction: column;
          border-top: 1pt solid #000;
          border-left: 1pt solid #000;
        }

        .cat-header {
          background-color: #e5e5e5;
          font-weight: 700;
          font-size: ${fontSize};
          text-transform: uppercase;
          border-right: 1pt solid #000;
          border-bottom: 1pt solid #000;
          padding: 0 4px;
          height: ${CAT_HEIGHT}mm;
          display: flex;
          align-items: center;
          overflow: hidden;
        }

        .row {
          display: flex;
          width: 100%;
        }

        .item-cell {
          flex: 1;
          display: flex;
          align-items: center;
          height: ${ROW_HEIGHT}mm;
          border-right: 1pt solid #000;
          border-bottom: 1pt solid #000;
          overflow: hidden;
        }
        
        .item-cell.empty {
          background: #fff;
        }

        .idx {
          width: ${idxWidth};
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          border-right: 1pt solid #000;
          font-size: 6.5pt;
        }

        .text {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 2px;
          padding: 0 2px;
          white-space: nowrap;
          overflow: hidden;
          line-height: 1;
        }

        .en { font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
        .cn { font-size: 6pt; color: #444; }

        .checks {
          display: flex;
          height: 100%;
          width: ${checksWidth};
          border-left: 1pt solid #000;
        }

        .box {
          flex: 1;
          border-right: 1pt solid #000;
        }
        .box:last-child { border-right: none; }

        .cut-line {
          height: ${CUT_HEIGHT}mm;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #888;
          font-size: 8px;
          overflow: hidden;
          break-inside: avoid;
        }
        .scissor { margin-right: 5px; transform: rotate(180deg); display: inline-block; }
        .dash {
          flex: 1;
          border-bottom: 1px dashed #888;
        }
      </style>
    </head>
    <body>
      ${bodyHtml}
    </body>
    </html>
  `;
}
