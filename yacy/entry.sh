#!/bin/sh
# 初回起動時だけ lab 用の設定を DATA/SETTINGS/yacy.conf に置いてから YaCy を起動する。
# yacy.conf は defaults/yacy.init を上書きする差分として読まれ、以後 YaCy 自身が書き足す。
set -e
DATA=/opt/yacy_search_server/DATA
mkdir -p "$DATA/SETTINGS"
if [ ! -f "$DATA/SETTINGS/yacy.conf" ]; then
  cp /lab/yacy.conf "$DATA/SETTINGS/yacy.conf"
  # virgin ピアは自分の IP を知らず、seed に IP が載らないためブートストラップできない。
  # docker network 内のアドレスを固定 IP として与える
  echo "staticIP=${STATIC_IP:-$(hostname -i | awk '{print $1}')}" >> "$DATA/SETTINGS/yacy.conf"
  # ノードごとの追加設定（改行区切りの key=value）
  if [ -n "$YACY_CONF" ]; then printf '%s\n' "$YACY_CONF" >> "$DATA/SETTINGS/yacy.conf"; fi
  # Java のヒープ（例 YACY_XMX=500m）。startYACY.sh は javastart_Xmx の行を 1 つだけ読むので、足さずに置き換える
  if [ -n "$YACY_XMX" ]; then sed -i "s/^javastart_Xmx=.*/javastart_Xmx=Xmx$YACY_XMX/" "$DATA/SETTINGS/yacy.conf"; fi
fi
exec /bin/sh /opt/yacy_search_server/startYACY.sh -f
