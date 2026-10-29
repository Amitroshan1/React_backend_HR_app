import StockInventoryForm from "./StockInventoryForm";

/** Fixed-asset bulk stock — re-export shared stock form. */
export default function OfficeStockForm(props) {
  return (
    <StockInventoryForm
      inventoryCategory="Fixed Assets"
      sectionTitle="Fixed assets"
      hint="Track items by quantity (e.g. 10 chairs from a supplier). No employee assignment or serial numbers."
      stockCategory="Stock"
      saveErrorMessage="Failed to save fixed assets."
      {...props}
    />
  );
}
