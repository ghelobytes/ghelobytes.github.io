---
layout: post
title:  Exporting ODK instances to Excel
date:   2014-10-16 23:56:00
categories: odk
---
So I've come to the part where I needed to export the ODK instances (forms) to Excel. ODK Briefcase does this just fine but I wanted to write my custom tool in .NET (csharp) for a more controlled behaviour.

Good thing I didn't have to reinvent the wheel. I came across [ExcelLibrary](https://code.google.com/p/excellibrary/) which made exporting XML to Excel a breeze. All I needed to do is to read all the XML file into a dataset via:

``` csharp
DataSet ds = new DataSet();
ds.ReadXml("form_instance1.xml");
ds.ReadXml("form_instance2.xml");
ds.ReadXml("form_instance3.xml");
```

then all you have to do is:
    
    ExcelLibrary.DataSetHelper.CreateWorkbook("my_excel.xls", ds);

passing `ds` as the content.

But then an `Invalid cell value` error occured. According to [this](https://code.google.com/p/excellibrary/issues/detail?id=99) page, the error might be caused by `DBNull` values.

The solution proposed was to write your own `CreateWorkbook` function.


``` csharp
private static void CreateWorkbook(String filePath, DataSet dataset)
{
if (dataset.Tables.Count == 0)
    throw new ArgumentException("DataSet needs to have at least one DataTable", "dataset");

Workbook workbook = new Workbook();
foreach (DataTable dt in dataset.Tables)
{
    Worksheet worksheet = new Worksheet(dt.TableName);
    for (int i = 0; i < dt.Columns.Count; i++)
    {
	// Add column header
	worksheet.Cells[0, i] = new Cell(dt.Columns[i].ColumnName);

	// Populate row data
	for (int j = 0; j < dt.Rows.Count; j++)
	    //See here??
	    worksheet.Cells[j + 1, i] = new Cell(dt.Rows[j][i] == DBNull.Value ? "" : dt.Rows[j][i]);
    }
    workbook.Worksheets.Add(worksheet);
}
workbook.Save(filePath);
}
```

This also gave me the benefit of having granular control on what part of the form is to be exported, any data transformation, etc....



