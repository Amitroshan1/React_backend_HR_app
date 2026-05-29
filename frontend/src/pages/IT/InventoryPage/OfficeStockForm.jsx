import StockInventoryForm from "./StockInventoryForm";

/** Office bulk stock — re-export shared stock form. */
export default function OfficeStockForm(props) {
  return (
    <StockInventoryForm
      inventoryCategory="Office Assets"
      sectionTitle="Office stock"
      hint="Track items by quantity (e.g. 10 chairs from a supplier). No employee assignment or serial numbers."
      stockCategory="Stock"
      saveErrorMessage="Failed to save office stock."
      {...props}
    />
  );
}
