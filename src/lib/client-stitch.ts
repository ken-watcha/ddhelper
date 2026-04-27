/**
 * 확장에서 받은 슬라이스 배열을 페이지(브라우저 메인 스레드)에서 한 장으로 합침.
 *
 * 왜 클라이언트에서 합치나?
 *   service worker 안에서 canvas.convertToBlob으로 12MP+ PNG를 인코딩하면
 *   수 초간 SW가 다른 일을 못 해 Chrome이 SW를 강제 종료시킴 → "응답 전 끊어짐" 에러.
 *   페이지 컨텍스트의 HTMLCanvasElement는 그런 제약이 없으므로 안전하게 합성 가능.
 */

interface Slice {
  dataUrl: string;
  scrollY: number;
}

interface RawCapture {
  slices: Slice[];
  pageWidth: number;
  pageHeight: number;
  clientHeight: number;
}

/**
 * 슬라이스들을 합쳐 단일 PNG data URL을 반환.
 * 첫 슬라이스 비트맵 width / pageWidth로 DPR scale을 계산.
 */
export async function stitchClientSide(raw: RawCapture): Promise<string> {
  if (!raw.slices || raw.slices.length === 0) {
    throw new Error("슬라이스 없음");
  }

  // 모든 슬라이스를 ImageBitmap으로 디코드
  const bitmaps = await Promise.all(
    raw.slices.map(async (s) => {
      const blob = await (await fetch(s.dataUrl)).blob();
      const bitmap = await createImageBitmap(blob);
      return { bitmap, scrollY: s.scrollY };
    })
  );

  const first = bitmaps[0].bitmap;
  const scale = first.width / raw.pageWidth; // 보통 1 또는 DPR (2)
  const canvasWidth = first.width;
  const canvasHeight = Math.round(raw.pageHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context 생성 실패");

  for (const { bitmap, scrollY } of bitmaps) {
    ctx.drawImage(bitmap, 0, Math.round(scrollY * scale));
    bitmap.close();
  }

  return canvas.toDataURL("image/png");
}
