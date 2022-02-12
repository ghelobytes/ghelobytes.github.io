---
layout: post
title:  Notes to Self
date:   2015-03-05
categories: programming
---

This will be my "Things I Learned" series.

#### Python
- Remove extra spaces in string

        my_string = " ".join(my_string.split())


#### Amazon S3
- Always set metadata before setting file contents

        key.set_metadata('Content-Type', mimetypes.guess_type(filename)[0])
        key.set_metadata('Content-Disposition', 'attachment;filename="'+filename+'"')
        key.set_contents_from_file(file)

