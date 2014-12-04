---
layout: post
title:  Editing files in Ubuntu thru WinSCP
date:   2014-11-03 09:42:00
categories: linux
---
I wasn't born to edit configuration files using CLI. Although `nano` usually saves the day, I still love the syntax highlighting of `notepad++`.
Maybe this is because I grew of working on Windows.

But how do you edit config files in a remote Ubuntu server from my Windows desktop? I know I've tried that before but it usually involves using a `root` account to work around the permission issues.
Fortunately I came across this [post](https://holisticsecurity.wordpress.com/2012/09/03/open-files-ubuntu-root-from-winscp-remotely/).

Just to make sure I had it recorded, these are the steps I did:

1. SSHed to `192.168.x.x` 
2. Edited the sudoer file: `sudo nano /etc/sudoers`
3. Added the following at the end of the file:

```
### added by ghelo 03 nov 2014
systems1 ALL=NOPASSWD: /usr/lib/openssh/sftp-server
```
4. Launched WinSCP in the remote client
5. Entered login credentials as we normally would
6. In the **advanced button**, clicked SFTP and entered `/usr/lib/openssh/sftp-server` in the Protocol options > SFTP server
7. Click Login
8. Done

After doing the steps above, I can now edit the remote server files using `Notepad++` sans permission problem.

Happiness!!!

