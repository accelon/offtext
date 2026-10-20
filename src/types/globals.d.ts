// 只宣告跨檔共享的瀏覽器全域；專案刻意不追求完整型別，讓舊程式可以
// 逐步加上註解，而不是一次改寫成嚴格的模組。
export {};

declare global {
  interface Window {
    [key: string]: any;
  }

  var module: any;
  var require: ((id: string) => any) | undefined;
}
