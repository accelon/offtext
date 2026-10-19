# 巢式文字

巢狀文字，是以 ![[basicofftag.md]] 標記的offtext。
至少有兩個部份「引用」以及資料表。

## 資料表

資料表只是 key value pairs，不限實作方式。
value 也是 offtext 。
資料表以 domain 區分。
^[entry@domain]
key 為 _ 表示首頁。
value 以 @ 開頭，表示alias ，直接 redirect 到該 key。


```
人工神經元  構成^[神經網絡]的基本單元。
神經元  @人工神經元

^[神經元]   等效於  ^[神經元|人工神經元]
```
## 交互流程

用戶點擊「引用」，系統到資料表搜尋（不指定 domain ，都找一遍），找到之後，在原處塞入 value ，因為value 也是offtext ，此操作是巢狀的，可以不斷展開。再點一次「引用」，value 不再顯示。

## 視覺線索

每深一層的探索，以HSV 色相轉30%表示深度。

## 實現方式

以 html 技術實現