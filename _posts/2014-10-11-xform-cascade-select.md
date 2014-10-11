---
layout: post
title:  Cascading select inside a repeat (XLSform)
date:   2014-10-11 17:41:00
categories: odk
---
I keep on getting the error:

    XPath evaluation: type mismatch...
    You may need to use the indexed-repeat() function to specify which value you want

Stuck for 5 hours until I found the solution from various different post.
My `choice_filter` is set `${Q64.1}`. When I changed it to `current()/Q64.1` everything went fine.

Apparently this xml code is being generated:

    <itemset nodeset="instance('food_item')/root/item[food_category= /uct_form/S8/T11/Q64.1 ]">

instead of this one:

    <itemset nodeset="instance('food_item')/root/item[food_category=current()/Q64.1]">

I'm not yet sure if XLSform or ODK is at fault. I'm just happy to get it working again.
