---
layout: post
title:  Learning Linux
date:   2014-11-03 12:51:00
categories: linux
---

I've decided I should document common bash command I encounter every day.

Here is the list:

```shell
// list ports being listened to
$ netstat -ntlp | grep LISTEN

// list apps started by forever
$ forever list

// start an app using forever
$ forever start app.js

// stop an app that was started by forever
// first, get the index by running forever list, then:
$ forever stop 0

// reload nginx config
$ sudo service nginx reload

```

I will be updating this list often.

