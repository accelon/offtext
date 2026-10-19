# 基本標記語法

## 設計思路

Offtext 是一種 Standoff text markup， 其標記稱為 offtag。
offtext = plain text + offtag，適用於序列化。

offtag 可以很輕易地從offtext 抽走（記錄其位置）
基於同一份plain text 的 offtag ，抽出後很容易合併，過濾，再併入。
plain text 內容基本不變，可視為 read only 。
offtag 是對plain text 的各種加工，延伸。

## offtag 格式

offtag 以 ^ 開頭，緊接著是名稱 tagname

tagname 必須是 小寫字母 或 _ ，不能有數字。

## 引用
不帶tagname，只有方括號，稱為「引用」

```
   ^[引用]
   ^[引用@domain]   指定domain
   ^[顯示名|引用]    用戶看見顯示名
```

## 簡單參數

offtag 可以帶簡單參數，參數有八種前綴「 # @ . : / - ~ | 」 

```
    ^pg#id          識別符
    ^link@db        鏈接
    ^name@host.com  email, 網址
    ^abc:xyz        用戶自訂

```

## 識別符
id 開頭為數字時，「#」可以省略

```
    ^pg3
```

## 帶key value pairs
可含等效於html的屬性。

```
    tagname#id<參數1=值 參數2="含空 白">
```

值不含空白時， 可省略 "

```
    ^https<url=xxxx>
    ^title|https<url=www.deepseek.com>
```

## 夾文 以括號包住

夾文中不能出現 ^

tagname = "ck"
id ="1"
innertext="第一章"

```
    ^ck1【第一章】
```

## 屬性在夾文之前

夾文括號必須出現在屬性之後

```
    ^ck1<key=value>【第一章】
```

## 內文中的標記

    第二頁正文結束，標記「^pg3」緊接第三頁正文的開頭，若為英數，需加空白
    
```
    中^pg2文        ==> 中文  ，若為中文可直接寫
    acc^pg3 elon    ==> acc elon  , 以空白隔開
    acc^pg3<>elon   ==> accelon   ， 用空參數，去除空白
```

## 夾文支持的括號 (前後符號的Unicode值必須相差1)

半形 () 
全形「」『』〔〕（）︹︺︷︸【】︻︼《》〈〉︽︾︿﹀﹁﹂﹃﹄﹙﹚﹝﹞‘’“”〝〞
︵︶ 保留給拼形式，避免使用


## 簡單型多層id
多層id由數字與字母混合構成。字母層使用二十六進制（a=1, b=2 , etc）編碼，數字為十進制。

                等效於
    a   一層  = 0
    123 一層  = 123
    a3  兩層  = 0.3
    3a  兩層  = 3.0
    a3a 三層  = 0.3.0
    3a1 三層  = 3.0.1
    